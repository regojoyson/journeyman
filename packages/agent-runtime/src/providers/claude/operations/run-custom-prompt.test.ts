import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the options object the SDK's query() receives. The mock yields a single
// successful "result" message so runCustomPrompt completes its loop normally.
const captured: { options?: Record<string, unknown>; prompt?: string } = {};

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ prompt, options }: { prompt: string; options: Record<string, unknown> }) => {
    captured.prompt = prompt;
    captured.options = options;
    return (async function* () {
      yield { type: "result", subtype: "success", result: "ok" } as never;
    })();
  },
}));

import { runCustomPrompt } from "./run-custom-prompt.ts";

beforeEach(() => {
  captured.options = undefined;
  captured.prompt = undefined;
});

describe("runCustomPrompt — tool wiring into query()", () => {
  it("translates canonical tools into native Claude tools + allowedTools", async () => {
    await runCustomPrompt({
      prompt: "do a thing",
      outputMode: "text",
      tools: ["bash", "read-file", "search"],
    });

    expect(captured.options?.tools).toEqual(["Bash", "Read", "Grep", "Glob"]);
    // allowedTools is always the same list as tools — the permission allowlist.
    expect(captured.options?.allowedTools).toEqual(captured.options?.tools);
  });

  it("omits tools/allowedTools entirely for a pure-prompt step (no tools)", async () => {
    await runCustomPrompt({
      prompt: "just answer",
      outputMode: "text",
      tools: [],
    });

    expect(captured.options).toBeDefined();
    expect("tools" in (captured.options ?? {})).toBe(false);
    expect("allowedTools" in (captured.options ?? {})).toBe(false);
  });

  it("treats undefined tools the same as an empty list", async () => {
    await runCustomPrompt({ prompt: "hi", outputMode: "text" });
    expect("tools" in (captured.options ?? {})).toBe(false);
  });

  it("always passes the bypass-permission flags alongside the tool list", async () => {
    await runCustomPrompt({ prompt: "x", outputMode: "text", tools: ["bash"] });
    expect(captured.options?.permissionMode).toBe("bypassPermissions");
    expect(captured.options?.allowDangerouslySkipPermissions).toBe(true);
    expect(captured.options?.settingSources).toEqual([]);
  });
});
