import { createLogger } from "@journeyman/core";
import { confinementSystemPrompt } from "../../../workspace-guard/index.ts";
import { logOpenCodeTranscript, logSessionEvent } from "../utils/sdk-logger.ts";
import { openCodeInfoToTokenUsage } from "../utils/usage.ts";
import { openCodeToolsConfig } from "../tool-mapping.ts";
import { validateStructured, salvageStructured } from "../structured.ts";
import { resolveOpenCodeModel } from "../model.ts";
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

/** Concatenate the text of all text parts in a prompt response. */
function extractText(data: { parts?: Array<{ type?: string; text?: string }> }): string {
  return (data.parts ?? [])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

/**
 * Build the stable `system` prefix: workspace confinement + MCP system prompts.
 * Keeping this stable text in `system` (not in the user `parts`) lets the model
 * server cache it across steps. OpenCode places Anthropic cache breakpoints itself
 * and other vendors auto-cache, so no explicit marker is needed here.
 */
function buildSystem(opts: RunCustomPromptOptions): string | undefined {
  const parts: string[] = [];
  if (opts.cwd) parts.push(confinementSystemPrompt(opts.cwd));
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

  // Only the dynamic task in the user part; stable confinement now rides in `system`.
  const promptText = opts.prompt;

  // Best-effort server-side cancellation: when the run is aborted, tell OpenCode to
  // stop the agent loop. Swallow abort's own errors so they never mask the cancellation.
  const onAbort = () => { void Promise.resolve(client.session.abort({ sessionID: sid })).catch(() => {}); };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  let res: Awaited<ReturnType<typeof client.session.prompt>>;
  try {
    res = await client.session.prompt({
      sessionID: sid,
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

  if (opts.signal?.aborted) throw abortError(opts.signal);

  if (!res.data) {
    const r = res as { error?: unknown; response?: { status?: number; statusText?: string } };
    const error = `opencode session.prompt failed: ${describeSdkError(r.error, r.response)}`;
    log.error({ sessionId, error }, "runCustomPrompt failed (no data)");
    return { sessionId, error };
  }

  // Dump the model transcript (text + tool calls) to the UI log, gated by level.
  logOpenCodeTranscript((res.data as { parts?: unknown }).parts as never, opts.onLog, opts.agentLogLevel ?? "all");

  const info = res.data.info as { error?: unknown; structured?: unknown; tokens?: unknown; modelID?: string; providerID?: string };
  logSessionEvent(log, sessionId, info as never, opts.onLog);
  const usage = openCodeInfoToTokenUsage(info as never);

  if (info.error) {
    if (info.error && typeof info.error === "object" && (info.error as { name?: string }).name === "MessageAbortedError") {
      throw abortError(opts.signal);
    }
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "runCustomPrompt failed");
    return { sessionId, error, usage };
  }

  if (opts.outputMode === "none") return { sessionId, usage };
  if (opts.outputMode === "text") return { sessionId, result: extractText(res.data as never), usage };

  // structured: validate → salvage from text → fail clearly.
  const schema = opts.outputSchema as Record<string, unknown>;
  const valid = validateStructured(info.structured, schema);
  if (valid.ok) return { sessionId, structured: valid.value, usage };

  const text = extractText(res.data as never);
  const salvaged = salvageStructured(text, schema);
  if (salvaged) {
    log.warn({ sessionId, reason: valid.reason }, "structured salvaged from text");
    return { sessionId, structured: salvaged, usage };
  }

  const error = `model did not return valid structured output (${valid.reason}). Model said: ${text.slice(0, 500) || "(no text)"}`;
  log.error({ sessionId, error }, "runCustomPrompt structured invalid");
  return { sessionId, error, usage };
}
