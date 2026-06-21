import { describe, it, expect } from "vitest";
import { modelUsageToTokenUsage } from "./usage.ts";

describe("modelUsageToTokenUsage", () => {
  it("fans a multi-model map into one row per model", () => {
    const out = modelUsageToTokenUsage({
      "claude-opus-4-8": { inputTokens: 1200, outputTokens: 800, cacheReadInputTokens: 5000, cacheCreationInputTokens: 10 },
      "claude-haiku-4-5": { inputTokens: 300, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    });
    expect(out).toHaveLength(2);
    const opus = out.find((u) => u.model === "claude-opus-4-8")!;
    expect(opus).toMatchObject({
      provider: "claude", vendor: "anthropic", model: "claude-opus-4-8",
      inputTokens: 1200, outputTokens: 800, cacheReadTokens: 5000, cacheCreationTokens: 10,
    });
    expect(opus.totalTokens).toBe(2000);
    expect(opus.raw).toBeDefined();
  });

  it("returns [] for empty/undefined input", () => {
    expect(modelUsageToTokenUsage(undefined)).toEqual([]);
    expect(modelUsageToTokenUsage({})).toEqual([]);
  });

  it("tolerates missing fields", () => {
    const out = modelUsageToTokenUsage({ m1: { inputTokens: 5 } as any });
    expect(out[0]).toMatchObject({ model: "m1", inputTokens: 5 });
    expect(out[0].outputTokens).toBeUndefined();
  });
});
