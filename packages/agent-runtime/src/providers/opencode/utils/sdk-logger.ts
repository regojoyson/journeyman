// packages/agent-runtime/src/providers/opencode/utils/sdk-logger.ts
import { createLogger, type AgentLogLevel, type CodingCliLogFn, type Logger } from "@journeyman/core";

const log = createLogger("opencode:sdk");
const MAX_LINE_LEN = 200;

/** Minimal shape of an OpenCode message Part (text / tool / other), as returned
 * on `res.data.parts`. We dump these AFTER the prompt completes — robust and
 * version-agnostic, unlike subscribing to the SSE event stream. */
export interface OpenCodePart {
  type: string;
  id?: string;
  text?: string;
  tool?: string;
  state?: { status?: string; input?: Record<string, unknown>; error?: string };
  /** Present on text parts; `time.end` is set once the segment is settled. */
  time?: { start?: number; end?: number };
  [k: string]: unknown;
}

function singleLine(s: string, max = 120): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

function allowsAssistantText(l: AgentLogLevel): boolean { return l === "all"; }
function allowsToolUse(l: AgentLogLevel): boolean { return l === "medium" || l === "all"; }
function allowsToolResult(l: AgentLogLevel): boolean { return l === "all"; }

function summarizeInput(input: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  if (typeof inp.command === "string") return `$ ${singleLine(inp.command, 140)}`;
  if (typeof inp.path === "string") return singleLine(inp.path, 140);
  if (typeof inp.filePath === "string") return singleLine(inp.filePath, 140);
  if (typeof inp.pattern === "string") return singleLine(inp.pattern, 140);
  const keys = Object.keys(inp);
  return keys.length ? keys.join(",") : "";
}

/**
 * Emit the model's transcript (text + tool calls) to the UI log via `onLog`,
 * gated by `level`. Called once after the prompt resolves with `res.data.parts`.
 * Always debug-logs to stderr regardless of level (the runner forwards stderr).
 */
/** Emit the `🔧 tool: name(args)` invocation line (gated at medium/all). */
export function renderToolInvocation(part: OpenCodePart, onLog?: CodingCliLogFn, level: AgentLogLevel = "all"): void {
  const tool = typeof part.tool === "string" ? part.tool : "tool";
  log.debug({ tool, status: part.state?.status }, "tool part");
  if (!onLog || !allowsToolUse(level)) return;
  const arg = summarizeInput(part.state?.input);
  onLog(singleLine(arg ? `🔧 tool: ${tool}(${arg})` : `🔧 tool: ${tool}`, MAX_LINE_LEN), { part });
}

/** Emit the `📥 name: ok|error` result line (gated at all). */
export function renderToolResult(part: OpenCodePart, onLog?: CodingCliLogFn, level: AgentLogLevel = "all"): void {
  if (!onLog || !allowsToolResult(level)) return;
  const tool = typeof part.tool === "string" ? part.tool : "tool";
  const st = part.state ?? {};
  if (st.status === "error") {
    onLog(singleLine(`📥 ${tool}: error: ${st.error ?? ""}`, MAX_LINE_LEN), { part });
  } else if (st.status === "completed") {
    onLog(`📥 ${tool}: ok`, { part });
  }
}

/** Emit the `🤖 assistant: text` line (gated at all). */
export function renderText(part: OpenCodePart, onLog?: CodingCliLogFn, level: AgentLogLevel = "all"): void {
  if (typeof part.text !== "string" || !part.text) return;
  log.debug({ text: part.text }, "assistant text");
  if (onLog && allowsAssistantText(level)) {
    onLog(singleLine(`🤖 assistant: ${part.text}`, MAX_LINE_LEN), { part });
  }
}

/** Render a single part fully (invocation + result + text) — used by the fallback dump. */
export function renderPart(part: OpenCodePart, onLog?: CodingCliLogFn, level: AgentLogLevel = "all"): void {
  if (part.type === "text") {
    renderText(part, onLog, level);
  } else if (part.type === "tool") {
    renderToolInvocation(part, onLog, level);
    renderToolResult(part, onLog, level);
  }
}

/**
 * Emit the model's transcript (text + tool calls) to the UI log via `onLog`,
 * gated by `level`. Used by the end-of-run fallback dump.
 */
export function logOpenCodeTranscript(
  parts: readonly OpenCodePart[] | undefined,
  onLog?: CodingCliLogFn,
  level: AgentLogLevel = "all",
): void {
  const ui = onLog && level !== "none" ? onLog : undefined;
  for (const part of parts ?? []) renderPart(part, ui, level);
}

/** Final session-result diagnostic. Routed through `onLog` so it is visible
 * (the old version used log.debug, dropped at the default `info` level), and
 * inspects OpenCode's `structured` key (not the Claude-shaped structured_output). */
export function logSessionEvent(
  logger: Logger,
  sessionId: string,
  info: { error?: unknown; structured?: unknown; [k: string]: unknown },
  onLog?: CodingCliLogFn,
): void {
  logger.info(
    { sessionId, hasError: !!info.error, hasStructured: info.structured !== undefined },
    "opencode session result",
  );
  onLog?.(`📦 session result: ${info.error ? "error" : info.structured !== undefined ? "structured" : "no-structured"}`);
}
