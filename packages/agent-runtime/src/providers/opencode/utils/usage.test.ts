import { describe, it, expect } from "vitest";
import { openCodeInfoToTokenUsage } from "./usage.ts";

describe("openCodeInfoToTokenUsage", () => {
  it("maps info.tokens with cache block", () => {
    const out = openCodeInfoToTokenUsage({
      modelID: "claude-3-5-sonnet",
      providerID: "anthropic",
      tokens: { input: 200, output: 60, reasoning: 12, cache: { read: 900, write: 5 } },
    });
    expect(out).toEqual([{
      // model recombines providerID + modelID to match the coding-model id used for pricing
      provider: "opencode", vendor: "anthropic", model: "anthropic/claude-3-5-sonnet",
      inputTokens: 200, outputTokens: 60, reasoningTokens: 12,
      cacheReadTokens: 900, cacheCreationTokens: 5, totalTokens: 260,
      raw: expect.anything(),
    }]);
  });

  it("recombines a multi-segment model id (lmstudio/qwen/...) to match pricing", () => {
    const out = openCodeInfoToTokenUsage({
      providerID: "lmstudio", modelID: "qwen/qwen3.6-35b-a3b",
      tokens: { input: 53406, output: 265, reasoning: 338, cache: { read: 0, write: 0 } },
    });
    expect(out[0].model).toBe("lmstudio/qwen/qwen3.6-35b-a3b");
    expect(out[0].vendor).toBe("lmstudio");
    expect(out[0].inputTokens).toBe(53406);
  });

  it("returns [] when tokens absent", () => {
    expect(openCodeInfoToTokenUsage({ modelID: "x", providerID: "y" })).toEqual([]);
    expect(openCodeInfoToTokenUsage(undefined)).toEqual([]);
  });
});
