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
      provider: "opencode", vendor: "anthropic", model: "claude-3-5-sonnet",
      inputTokens: 200, outputTokens: 60, reasoningTokens: 12,
      cacheReadTokens: 900, cacheCreationTokens: 5, totalTokens: 260,
      raw: expect.anything(),
    }]);
  });

  it("returns [] when tokens absent", () => {
    expect(openCodeInfoToTokenUsage({ modelID: "x", providerID: "y" })).toEqual([]);
    expect(openCodeInfoToTokenUsage(undefined)).toEqual([]);
  });
});
