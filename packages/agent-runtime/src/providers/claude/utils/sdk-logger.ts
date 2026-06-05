import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createLogger, type AgentLogLevel, type CodingCliLogFn } from "@journeyman/core";

const log = createLogger("claude:sdk");
const MAX_LINE_LEN = 200;

function singleLine(s: string, max = 120): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

function summarizeToolInput(name: string, input: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  if (name === "Bash" && typeof inp.command === "string") {
    return `$ ${singleLine(inp.command, 140)}`;
  }
  if (typeof inp.file_path === "string") return singleLine(inp.file_path, 140);
  if (typeof inp.path === "string") return singleLine(inp.path, 140);
  if (typeof inp.pattern === "string") return singleLine(inp.pattern, 140);
  const keys = Object.keys(inp);
  return keys.length ? keys.join(",") : "";
}

// What each level allows through.
function allowsAssistantText(level: AgentLogLevel): boolean {
  return level === "all";
}
function allowsToolUse(level: AgentLogLevel): boolean {
  return level === "medium" || level === "all";
}
function allowsToolResult(level: AgentLogLevel): boolean {
  return level === "all";
}
function allowsResult(level: AgentLogLevel): boolean {
  return level === "light" || level === "medium" || level === "all";
}

export function logSdkMessage(
  msg: SDKMessage,
  onLog?: CodingCliLogFn,
  level: AgentLogLevel = "all",
): void {
  // Stdout debug logs always run, regardless of level — only the UI-bound
  // `onLog` channel is gated by `level`.
  const ui = onLog && level !== "none" ? onLog : undefined;

  if (msg.type === "assistant") {
    for (const block of msg.message?.content ?? []) {
      if ("text" in block && block.text) {
        log.debug({ text: block.text }, "agent message");
        if (ui && allowsAssistantText(level)) {
          ui(
            singleLine(`🤖 assistant: ${block.text}`, MAX_LINE_LEN),
            { sdkMessage: msg },
          );
        }
      } else if ("name" in block) {
        const input = (block as any).input ?? {};
        log.debug({ tool: block.name, input }, "tool use");
        if (ui && allowsToolUse(level)) {
          const argSummary = summarizeToolInput(block.name, input);
          const line = argSummary
            ? `🔧 tool: ${block.name}(${argSummary})`
            : `🔧 tool: ${block.name}`;
          ui(singleLine(line, MAX_LINE_LEN), { sdkMessage: msg });
        }
      }
    }
  } else if (msg.type === "user") {
    for (const block of (msg.message?.content as any[]) ?? []) {
      if (block.type === "tool_result") {
        const output = Array.isArray(block.content)
          ? block.content.map((c: any) => c.text ?? "").join("")
          : block.content ?? "";
        if (output) log.debug({ output: String(output).trim() }, "tool result");
        if (ui && allowsToolResult(level)) {
          const isError = block.is_error === true;
          const len = typeof output === "string" ? output.length : 0;
          ui(
            `📥 tool_result: ${isError ? "error" : "ok"} (${len} chars)`,
            { sdkMessage: msg },
          );
        }
      }
    }
  } else if (msg.type === "result") {
    log.debug({ subtype: msg.subtype }, "sdk done");
    if (ui && allowsResult(level)) {
      const ok = msg.subtype === "success";
      ui(
        ok ? `✅ result: success` : `❌ result: ${msg.subtype}`,
        { sdkMessage: msg },
      );
    }
  }
}
