import { describe, it, expect, vi } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: () => (async function* () {
    yield { type: "assistant", message: { model: "claude-x", usage: { input_tokens: 200, output_tokens: 40 } } } as never;
    yield { type: "assistant", message: { model: "claude-x", usage: { input_tokens: 100, output_tokens: 10 } } } as never;
    throw new Error("connection reset");
  })(),
}));

import { runCustomPrompt } from "./run-custom-prompt.ts";

describe("runCustomPrompt — usage on failure", () => {
  it("returns tokens accumulated across assistant messages when the run throws", async () => {
    const res = await runCustomPrompt({ prompt: "x", outputMode: "text" });
    expect(res.error).toContain("connection reset");
    expect(res.usage).toBeDefined();
    expect(res.usage).toHaveLength(1);
    expect(res.usage![0]).toMatchObject({ model: "claude-x", inputTokens: 300, outputTokens: 50, totalTokens: 350 });
  });
});
