import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@journeyman/core";
import { confinementSystemPrompt } from "../../../workspace-guard/index.ts";
import {
  logOpenCodeTranscript, logSessionEvent,
  renderToolInvocation, renderToolResult, renderText, renderReasoning,
} from "../utils/sdk-logger.ts";
import { streamSessionLog } from "../utils/event-stream.ts";
import { openCodeInfoToTokenUsage } from "../utils/usage.ts";
import { openCodeToolsConfig } from "../tool-mapping.ts";
import { validateStructured, salvageStructured } from "../structured.ts";
import { resolveOpenCodeModel } from "../model.ts";
import { OPENCODE_AGENT } from "../server-config.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { RunCustomPromptOptions, RunCustomPromptResult } from "@journeyman/core";

const log = createLogger("opencode:custom-prompt");

/** How many times opencode itself re-asks the model to satisfy the json_schema. */
const STRUCTURED_RETRY_COUNT = Number(process.env.OPENCODE_STRUCTURED_RETRIES) || 2;

/**
 * Render an OpenCode SDK error envelope into a diagnosable string. The SDK
 * collapses a non-2xx HTTP response with an empty body to `error: {}` (see
 * @opencode-ai/sdk client.gen.js), so the only actionable detail — the status —
 * lives on the result tuple's `response`. Surface it, or failures read as `{}`.
 */
function describeSdkError(error: unknown, response?: { status?: number; statusText?: string }): string {
  const http = response?.status != null
    ? `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`
    : "";
  const empty =
    error == null ||
    (typeof error === "string" && error.length === 0) ||
    (typeof error === "object" && error !== null && Object.keys(error).length === 0);
  let body: string;
  if (empty) {
    body = http ? "(empty error body)" : "no data and no error returned (server unreachable?)";
  } else if (typeof error === "string") {
    body = error;
  } else {
    try { body = JSON.stringify(error); } catch { body = String(error); }
  }
  return [http, body].filter(Boolean).join(": ");
}

type Part = { type?: string; text?: string };

/** Concatenate the text of all parts of the given `type` ("text" or "reasoning"). */
function concatParts(data: { parts?: Part[] }, type: string): string {
  return (data.parts ?? [])
    .filter((p) => p.type === type && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

/** Concatenate the text of all text parts in a prompt response. */
function extractText(data: { parts?: Part[] }): string {
  return concatParts(data, "text");
}

/**
 * Best-effort structured salvage from the model's reply, trying the content channel
 * first and then the reasoning channel. Reasoning models (e.g. qwen via LM Studio)
 * routinely emit the JSON answer into `reasoning_content` — surfaced here as a
 * `reasoning` part — while leaving `content` (the text parts) empty, which would
 * otherwise look like "no output". Each channel is tried separately so a stray brace
 * in one can't corrupt the JSON match in the other. Validation-safe: returns only a
 * schema-conforming object.
 */
function salvageFromParts(data: { parts?: Part[] }, schema: Record<string, unknown>): Record<string, unknown> | undefined {
  return salvageStructured(extractText(data), schema) ?? salvageStructured(concatParts(data, "reasoning"), schema);
}

/**
 * The structured result on the assistant message. The installed SDK (@opencode-ai/sdk
 * v2) exposes it as `info.structured`; the SDK docs and the v1/HTTP surface call it
 * `structured_output`. Read both so a SDK/server version change can't silently strand
 * the result. See https://opencode.ai/docs/sdk/#json-schema-format.
 */
function readStructured(info: { structured?: unknown; structured_output?: unknown }): unknown {
  return info.structured !== undefined ? info.structured : info.structured_output;
}

/**
 * Render an opencode `AssistantMessage.error` into a diagnosable string. Per the SDK
 * docs (#error-handling) each error has a `name` and nested `data`; a
 * StructuredOutputError additionally carries `data.retries`.
 */
function describeInfoError(error: unknown): string {
  if (typeof error === "string") return error;
  const e = error as { name?: string; data?: { message?: string; retries?: number } };
  if (e?.name) {
    const msg = e.data?.message ?? "";
    const retries =
      e.name === "StructuredOutputError" && typeof e.data?.retries === "number"
        ? ` (after ${e.data.retries} ${e.data.retries === 1 ? "retry" : "retries"})`
        : "";
    return `${e.name}: ${msg}${retries}`.trim();
  }
  try { return JSON.stringify(error); } catch { return String(error); }
}

/**
 * Build the stable `system` prefix: workspace confinement + MCP system prompts.
 * Keeping this stable text in `system` (not in the user `parts`) lets the model
 * server cache it across steps. OpenCode places Anthropic cache breakpoints itself
 * and other vendors auto-cache, so no explicit marker is needed here.
 */
/** Immediate, non-hidden subdirectory names of `root` (the cloned repos); [] on any error. */
function workspaceRepoDirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function buildSystem(opts: RunCustomPromptOptions): string | undefined {
  const parts: string[] = [];
  if (opts.cwd) {
    parts.push(confinementSystemPrompt(opts.cwd));
    // Point the agent at the cloned repos so it starts in the right place instead
    // of probing the workspace blindly. `external_directory: "deny"` already
    // hard-blocks anything outside opts.cwd; this just tells the model where to begin.
    const repos = workspaceRepoDirs(opts.cwd);
    if (repos.length) {
      const paths = repos.map((r) => join(opts.cwd as string, r)).join(", ");
      parts.push(
        `The repositories cloned into your workspace are: ${paths}. ` +
          `Begin your work in the relevant repository; everything outside ${opts.cwd} is off-limits.`,
      );
    }
  }
  for (const m of opts.mcps ?? []) if (m.systemPrompt) parts.push(m.systemPrompt);
  return parts.length ? parts.join("\n\n") : undefined;
}

/** A consistent abort error to throw, matching how Claude/AISDK surface cancellation. */
function abortError(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException("Aborted", "AbortError");
}

/**
 * Run a custom prompt through OpenCode. `client` is an already-started server
 * client (index.ts owns start/close). Honors outputMode none|text|structured,
 * tools, cwd (as `directory`), and MCP system prompts.
 */
export async function runCustomPrompt(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: RunCustomPromptOptions,
): Promise<RunCustomPromptResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();

  if (opts.signal?.aborted) throw abortError(opts.signal);

  const model = resolveOpenCodeModel(opts.model, config.model);
  if (!model) return { sessionId, error: "opencode: no model configured (set opts.model as 'providerID/modelID')" };

  if (opts.outputMode === "structured" && !opts.outputSchema) {
    return { sessionId, error: "outputMode='structured' requires outputSchema" };
  }

  log.info(
    { sessionId, outputMode: opts.outputMode, mcpCount: opts.mcps?.length ?? 0, skillCount: opts.skills?.length ?? 0 },
    "runCustomPrompt start",
  );

  const tools = openCodeToolsConfig(opts.tools ?? []);
  const system = buildSystem(opts);

  const session = await client.session.create({ title: "customPrompt" });
  if (!session.data) {
    return { sessionId, error: `opencode session.create failed: ${describeSdkError((session as { error?: unknown }).error)}` };
  }
  const sid = session.data.id;

  // Live log streaming: forward opencode's SSE part events through onLog as they
  // happen. Only when a UI log sink is present.
  const level = opts.agentLogLevel ?? "all";
  const logStream = opts.onLog
    ? streamSessionLog(client, sid, (e) => {
        if (e.kind === "tool-invoke") renderToolInvocation(e.part, opts.onLog, level);
        else if (e.kind === "tool-result") renderToolResult(e.part, opts.onLog, level);
        else if (e.kind === "reasoning") renderReasoning(e.part, opts.onLog, level);
        else renderText(e.part, opts.onLog, level);
      })
    : undefined;

  // Only the dynamic task in the user part; stable confinement now rides in `system`.
  const promptText = opts.prompt;

  // Best-effort server-side cancellation: when the run is aborted, tell OpenCode to
  // stop the agent loop. Swallow abort's own errors so they never mask the cancellation.
  const onAbort = () => {
    logStream?.stop();
    void Promise.resolve(client.session.abort({ sessionID: sid })).catch(() => {});
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  let res: Awaited<ReturnType<typeof client.session.prompt>>;
  try {
    res = await client.session.prompt({
      sessionID: sid,
      agent: OPENCODE_AGENT,
      parts: [{ type: "text", text: promptText }],
      model,
      tools,
      ...(opts.cwd ? { directory: opts.cwd } : {}),
      ...(system ? { system } : {}),
      ...(opts.outputMode === "structured" && opts.outputSchema
        ? { format: { type: "json_schema", schema: opts.outputSchema, retryCount: STRUCTURED_RETRY_COUNT } }
        : {}),
    });
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }

  // The live stream resolves on session.idle (or natural stream end); on a
  // user abort, onAbort already called stop() so this resolves promptly too.
  const streamInfo = logStream ? await logStream.done : { emitted: 0, degraded: false };
  log.info({ sessionId, sid, emitted: streamInfo.emitted, degraded: streamInfo.degraded }, "log stream settled");

  if (opts.signal?.aborted) throw abortError(opts.signal);

  if (!res.data) {
    const r = res as { error?: unknown; response?: { status?: number; statusText?: string } };
    const error = `opencode session.prompt failed: ${describeSdkError(r.error, r.response)}`;
    log.error({ sessionId, error }, "runCustomPrompt failed (no data)");
    return { sessionId, error };
  }

  // If the live feed produced nothing (SSE failed/empty), dump the full transcript
  // from the stable messages endpoint so we never regress to a single final line.
  if (opts.onLog && streamInfo.emitted === 0) {
    try {
      const msgs = await client.session.messages({ sessionID: sid });
      const parts = ((msgs.data ?? []) as Array<{ parts?: unknown[] }>).flatMap((m) => m.parts ?? []);
      logOpenCodeTranscript(parts as never, opts.onLog, level);
    } catch {
      logOpenCodeTranscript((res.data as { parts?: unknown }).parts as never, opts.onLog, level);
    }
  }

  const info = res.data.info as { error?: unknown; structured?: unknown; structured_output?: unknown; tokens?: unknown; modelID?: string; providerID?: string };
  logSessionEvent(log, sessionId, info as never, opts.onLog);
  const usage = openCodeInfoToTokenUsage(info as never);

  if (info.error) {
    if (info.error && typeof info.error === "object" && (info.error as { name?: string }).name === "MessageAbortedError") {
      throw abortError(opts.signal);
    }
    // OpenCode's own structured-output coercion can give up (StructuredOutputError)
    // even though the model DID emit the JSON — just as plain text rather than through
    // the structured channel. This is common with small/local models (e.g. via LM
    // Studio) that ignore the format directive and print a ```json block instead.
    // Salvage is validation-safe — it returns only a schema-conforming object — so try
    // it before surfacing the error rather than discarding a usable result.
    if (opts.outputMode === "structured" && opts.outputSchema) {
      const salvaged = salvageFromParts(res.data as never, opts.outputSchema as Record<string, unknown>);
      if (salvaged) {
        log.warn({ sessionId, error: (info.error as { name?: string })?.name ?? "error" }, "structured salvaged from text/reasoning despite session error");
        return { sessionId, structured: salvaged, usage };
      }
    }
    const error = describeInfoError(info.error);
    log.error({ sessionId, error }, "runCustomPrompt failed");
    return { sessionId, error, usage };
  }

  if (opts.outputMode === "none") return { sessionId, usage };
  if (opts.outputMode === "text") return { sessionId, result: extractText(res.data as never), usage };

  // structured: validate → salvage from text/reasoning → fail clearly.
  const schema = opts.outputSchema as Record<string, unknown>;
  const valid = validateStructured(readStructured(info), schema);
  if (valid.ok) return { sessionId, structured: valid.value, usage };

  const salvaged = salvageFromParts(res.data as never, schema);
  if (salvaged) {
    log.warn({ sessionId, reason: valid.reason }, "structured salvaged from text/reasoning");
    return { sessionId, structured: salvaged, usage };
  }

  // Surface whichever channel the model actually used so the failure is diagnosable.
  const text = extractText(res.data as never) || concatParts(res.data as never, "reasoning");
  const error = `model did not return valid structured output (${valid.reason}). Model said: ${text.slice(0, 500) || "(no text)"}`;
  log.error({ sessionId, error }, "runCustomPrompt structured invalid");
  return { sessionId, error, usage };
}
