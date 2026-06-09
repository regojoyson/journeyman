// packages/agent-runtime/src/providers/opencode/utils/sdk-logger.ts
import { createLogger, type AgentLogLevel, type CodingCliLogFn, type Logger } from "@journeyman/core";

const log = createLogger("opencode:sdk");
const MAX_LINE_LEN = 200;

/** Minimal shape of an OpenCode v2 SSE event we care about. */
export interface OpenCodeEvent {
  id: string;
  type: string;
  properties: { timestamp: number; sessionID: string; [k: string]: unknown };
}

function singleLine(s: string, max = 120): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

function allowsAssistantText(l: AgentLogLevel): boolean { return l === "all"; }
function allowsToolUse(l: AgentLogLevel): boolean { return l === "medium" || l === "all"; }
function allowsToolResult(l: AgentLogLevel): boolean { return l === "all"; }
function allowsLight(l: AgentLogLevel): boolean { return l === "light" || l === "medium" || l === "all"; }

function summarizeInput(input: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  if (typeof inp.command === "string") return `$ ${singleLine(inp.command, 140)}`;
  if (typeof inp.path === "string") return singleLine(inp.path, 140);
  if (typeof inp.filePath === "string") return singleLine(inp.filePath, 140);
  if (typeof inp.pattern === "string") return singleLine(inp.pattern, 140);
  const keys = Object.keys(inp);
  return keys.length ? keys.join(",") : "";
}

/** Shape one OpenCode SSE event into a UI log line via `onLog`, gated by `level`.
 * Always debug-logs to stderr regardless of level (the runner forwards stderr). */
export function logOpenCodeEvent(
  ev: OpenCodeEvent,
  onLog?: CodingCliLogFn,
  level: AgentLogLevel = "all",
): void {
  const p = ev.properties;
  const ui = onLog && level !== "none" ? onLog : undefined;
  switch (ev.type) {
    case "session.next.text.ended": {
      const text = typeof p.text === "string" ? p.text : "";
      log.debug({ text }, "assistant text");
      if (ui && allowsAssistantText(level) && text) {
        ui(singleLine(`🤖 assistant: ${text}`, MAX_LINE_LEN), { event: ev });
      }
      break;
    }
    case "session.next.tool.called": {
      const tool = typeof p.tool === "string" ? p.tool : "tool";
      log.debug({ tool, input: p.input }, "tool call");
      if (ui && allowsToolUse(level)) {
        const arg = summarizeInput(p.input);
        ui(singleLine(arg ? `🔧 tool: ${tool}(${arg})` : `🔧 tool: ${tool}`, MAX_LINE_LEN), { event: ev });
      }
      break;
    }
    case "session.next.tool.success": {
      if (ui && allowsToolResult(level)) ui(`📥 tool_result: ok`, { event: ev });
      break;
    }
    case "session.next.tool.failed":
    case "session.next.step.failed": {
      const err = p.error;
      const msg = typeof err === "string" ? err : JSON.stringify(err ?? {});
      log.warn({ err }, "opencode error event");
      if (ui) ui(singleLine(`❌ ${ev.type === "session.next.tool.failed" ? "tool_result: error" : "step failed"}: ${msg}`, MAX_LINE_LEN), { event: ev });
      break;
    }
    case "session.next.retried": {
      if (ui && allowsLight(level)) ui(`🔁 retry (structured output)`, { event: ev });
      break;
    }
    default:
      break;
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
