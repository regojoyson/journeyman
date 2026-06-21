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

describe("runCustomPrompt — prompt caching (systemPrompt prefix)", () => {
  it("puts stable text in systemPrompt with the dynamic boundary when caching is on (default)", async () => {
    await runCustomPrompt({ prompt: "the task", outputMode: "text", cwd: "/ws" });
    const sp = captured.options?.systemPrompt as string[] | undefined;
    expect(Array.isArray(sp)).toBe(true);
    // stable confinement is in the cacheable prefix...
    expect(sp!.some((b) => b.includes("WORKSPACE BOUNDARY"))).toBe(true);
    // ...and the boundary marker terminates the cacheable prefix.
    expect(sp![sp!.length - 1]).toBe("SYSTEM_PROMPT_DYNAMIC_BOUNDARY");
    // only the dynamic task rides in the user prompt — stable text is NOT inlined.
    expect(captured.prompt).toBe("the task");
  });

  it("omits the boundary marker when caching is off", async () => {
    await runCustomPrompt({ prompt: "the task", outputMode: "text", cwd: "/ws", caching: false });
    const sp = captured.options?.systemPrompt as string[] | undefined;
    expect(Array.isArray(sp)).toBe(true);
    expect(sp).not.toContain("SYSTEM_PROMPT_DYNAMIC_BOUNDARY");
    expect(sp!.some((b) => b.includes("WORKSPACE BOUNDARY"))).toBe(true);
  });

  it("omits systemPrompt entirely when there is no stable text", async () => {
    await runCustomPrompt({ prompt: "just answer", outputMode: "text" });
    expect("systemPrompt" in (captured.options ?? {})).toBe(false);
  });
});
