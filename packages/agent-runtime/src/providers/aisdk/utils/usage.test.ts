import { describe, it, expect } from "vitest";
import { aiSdkUsageToTokenUsage, accumulateUsage, vendorFromConfig } from "./usage.ts";

describe("aiSdkUsageToTokenUsage", () => {
  it("maps a single-model usage object", () => {
    const out = aiSdkUsageToTokenUsage(
      { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
      "gpt-4o",
      "openai",
    );
    expect(out).toEqual([{
      provider: "aisdk", vendor: "openai", model: "gpt-4o",
      inputTokens: 100, outputTokens: 40, totalTokens: 140,
      reasoningTokens: undefined, cacheReadTokens: undefined,
      raw: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
    }]);
  });

  it("returns [] when usage is missing", () => {
    expect(aiSdkUsageToTokenUsage(undefined, "gpt-4o", "openai")).toEqual([]);
  });
});

describe("accumulateUsage", () => {
  it("sums token fields for the same model across two calls", () => {
    const a = aiSdkUsageToTokenUsage({ inputTokens: 100, outputTokens: 40, totalTokens: 140 }, "gpt-4o", "openai");
    const b = aiSdkUsageToTokenUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }, "gpt-4o", "openai");
    const out = accumulateUsage([...a, ...b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ model: "gpt-4o", inputTokens: 110, outputTokens: 45, totalTokens: 155 });
  });

  it("keeps distinct models separate", () => {
    const out = accumulateUsage([
      ...aiSdkUsageToTokenUsage({ inputTokens: 1 }, "a", "openai"),
      ...aiSdkUsageToTokenUsage({ inputTokens: 2 }, "b", "openai"),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("vendorFromConfig", () => {
  it("derives vendor from the ai-sdk npm package", () => {
    expect(vendorFromConfig({ npm: "@ai-sdk/openai" }, "gpt-4o")).toBe("openai");
    expect(vendorFromConfig({ npm: "@ai-sdk/anthropic" }, "claude-3-5-sonnet")).toBe("anthropic");
  });
  it("falls back to the model-id prefix", () => {
    expect(vendorFromConfig(undefined, "gpt-4o")).toBe("openai");
    expect(vendorFromConfig(undefined, "claude-3-5-sonnet")).toBe("anthropic");
  });
  it("returns undefined when unknown", () => {
    expect(vendorFromConfig(undefined, "some-local-model")).toBeUndefined();
  });
});
