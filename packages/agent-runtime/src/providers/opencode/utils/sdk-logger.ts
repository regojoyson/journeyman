// packages/agent-runtime/src/providers/opencode/utils/sdk-logger.ts
import { createLogger, type AgentLogLevel, type CodingCliLogFn, type Logger } from "@journeyman/core";

const log = createLogger("opencode:sdk");
const MAX_LINE_LEN = 200;

/** Minimal shape of an OpenCode message Part (text / tool / other), as returned
 * on `res.data.parts`. We dump these AFTER the prompt completes — robust and
 * version-agnostic, unlike subscribing to the SSE event stream. */
export interface OpenCodePart {
  type: string;
  text?: string;
  tool?: string;
  state?: { status?: string; input?: Record<string, unknown>; error?: string };
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
export function logOpenCodeTranscript(
  parts: readonly OpenCodePart[] | undefined,
  onLog?: CodingCliLogFn,
  level: AgentLogLevel = "all",
): void {
  const ui = onLog && level !== "none" ? onLog : undefined;
  for (const part of parts ?? []) {
    if (part.type === "text" && typeof part.text === "string" && part.text) {
      log.debug({ text: part.text }, "assistant text");
      if (ui && allowsAssistantText(level)) {
        ui(singleLine(`🤖 assistant: ${part.text}`, MAX_LINE_LEN), { part });
      }
    } else if (part.type === "tool") {
      const tool = typeof part.tool === "string" ? part.tool : "tool";
      const st = part.state ?? {};
      log.debug({ tool, status: st.status }, "tool part");
      if (ui && allowsToolUse(level)) {
        const arg = summarizeInput(st.input);
        ui(singleLine(arg ? `🔧 tool: ${tool}(${arg})` : `🔧 tool: ${tool}`, MAX_LINE_LEN), { part });
      }
      if (ui && allowsToolResult(level)) {
        if (st.status === "error") {
          ui(singleLine(`📥 ${tool}: error: ${st.error ?? ""}`, MAX_LINE_LEN), { part });
        } else if (st.status === "completed") {
          ui(`📥 ${tool}: ok`, { part });
        }
      }
    }
  }
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
