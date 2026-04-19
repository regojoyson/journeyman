import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@journeyman/core";

const log = createLogger("claude:sdk");

export function logSdkMessage(msg: SDKMessage): void {
  if (msg.type === "assistant") {
    for (const block of msg.message?.content ?? []) {
      if ("text" in block && block.text) {
        log.debug({ text: block.text }, "agent message");
      } else if ("name" in block) {
        log.debug({ tool: block.name, input: (block as any).input ?? {} }, "tool use");
      }
    }
  } else if (msg.type === "user") {
    for (const block of (msg.message?.content as any[]) ?? []) {
      if (block.type === "tool_result") {
        const output = Array.isArray(block.content)
          ? block.content.map((c: any) => c.text).join("")
          : block.content ?? "";
        if (output) log.debug({ output: output.trim() }, "tool result");
      }
    }
  } else if (msg.type === "result") {
    log.debug({ subtype: msg.subtype }, "sdk done");
  }
}
