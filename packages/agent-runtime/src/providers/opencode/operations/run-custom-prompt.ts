import { createLogger } from "@journeyman/core";
import { confinementSystemPrompt } from "../../../workspace-guard/index.ts";
import { logOpenCodeTranscript, logSessionEvent } from "../utils/sdk-logger.ts";
import { openCodeToolsConfig } from "../tool-mapping.ts";
import { validateStructured, salvageStructured } from "../structured.ts";
import { resolveOpenCodeModel } from "../model.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { RunCustomPromptOptions, RunCustomPromptResult } from "@journeyman/core";

const log = createLogger("opencode:custom-prompt");

/** How many times opencode itself re-asks the model to satisfy the json_schema. */
const STRUCTURED_RETRY_COUNT = Number(process.env.OPENCODE_STRUCTURED_RETRIES) || 2;

/** Render an OpenCode SDK error envelope into a diagnosable string. */
function describeSdkError(error: unknown): string {
  if (error == null) return "no data and no error returned (server unreachable?)";
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Concatenate the text of all text parts in a prompt response. */
function extractText(data: { parts?: Array<{ type?: string; text?: string }> }): string {
  return (data.parts ?? [])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

/** Merge MCP system prompts (if any) into one OpenCode `system` string. */
function buildSystem(opts: RunCustomPromptOptions): string | undefined {
  const parts: string[] = [];
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

  const promptText = [opts.cwd ? confinementSystemPrompt(opts.cwd) : "", opts.prompt].filter(Boolean).join("\n\n");

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
    const error = `opencode session.prompt failed: ${describeSdkError((res as { error?: unknown }).error)}`;
    log.error({ sessionId, error }, "runCustomPrompt failed (no data)");
    return { sessionId, error };
  }

  // Dump the model transcript (text + tool calls) to the UI log, gated by level.
  logOpenCodeTranscript((res.data as { parts?: unknown }).parts as never, opts.onLog, opts.agentLogLevel ?? "all");

  const info = res.data.info as { error?: unknown; structured?: unknown };
  logSessionEvent(log, sessionId, info as never, opts.onLog);

  if (info.error) {
    if (info.error && typeof info.error === "object" && (info.error as { name?: string }).name === "MessageAbortedError") {
      throw abortError(opts.signal);
    }
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "runCustomPrompt failed");
    return { sessionId, error };
  }

  if (opts.outputMode === "none") return { sessionId };
  if (opts.outputMode === "text") return { sessionId, result: extractText(res.data as never) };

  // structured: validate → salvage from text → fail clearly.
  const schema = opts.outputSchema as Record<string, unknown>;
  const valid = validateStructured(info.structured, schema);
  if (valid.ok) return { sessionId, structured: valid.value };

  const text = extractText(res.data as never);
  const salvaged = salvageStructured(text, schema);
  if (salvaged) {
    log.warn({ sessionId, reason: valid.reason }, "structured salvaged from text");
    return { sessionId, structured: salvaged };
  }

  const error = `model did not return valid structured output (${valid.reason}). Model said: ${text.slice(0, 500) || "(no text)"}`;
  log.error({ sessionId, error }, "runCustomPrompt structured invalid");
  return { sessionId, error };
}
