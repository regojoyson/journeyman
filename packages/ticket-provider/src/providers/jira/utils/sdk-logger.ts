import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export function logSdkMessage(msg: SDKMessage): void {
  if (msg.type === "assistant") {
    for (const block of msg.message?.content ?? []) {
      if ("text" in block && block.text) {
        console.log("[agent]", block.text);
      } else if ("name" in block) {
        console.log("[tool]", block.name, JSON.stringify((block as any).input ?? {}));
      }
    }
  } else if (msg.type === "user") {
    for (const block of (msg.message?.content as any[]) ?? []) {
      if (block.type === "tool_result") {
        const output = Array.isArray(block.content)
          ? block.content.map((c: any) => c.text).join("")
          : block.content ?? "";
        if (output) console.log("[tool result]", output.trim());
      }
    }
  } else if (msg.type === "result") {
    console.log("[done]", msg.subtype);
  }
}
