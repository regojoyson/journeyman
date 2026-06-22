import { describe, it, expect } from "vitest";
import { modelUsageToTokenUsage, createUsageAccumulator } from "./usage.ts";

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

describe("createUsageAccumulator", () => {
  it("sums per-assistant-message usage keyed by model", () => {
    const acc = createUsageAccumulator();
    acc.add({ type: "assistant", message: { model: "claude-x", usage: {
      input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 1 } } });
    acc.add({ type: "assistant", message: { model: "claude-x", usage: {
      input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
    const rows = acc.toTokenUsage();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "claude", vendor: "anthropic", model: "claude-x",
      inputTokens: 150, outputTokens: 30, cacheReadTokens: 5, cacheCreationTokens: 1, totalTokens: 180,
    });
  });

  it("ignores non-assistant messages and messages without usage", () => {
    const acc = createUsageAccumulator();
    acc.add({ type: "result", subtype: "success" });
    acc.add({ type: "assistant", message: { model: "claude-x" } });
    expect(acc.toTokenUsage()).toEqual([]);
  });

  it("separates models", () => {
    const acc = createUsageAccumulator();
    acc.add({ type: "assistant", message: { model: "a", usage: { input_tokens: 1, output_tokens: 1 } } });
    acc.add({ type: "assistant", message: { model: "b", usage: { input_tokens: 2, output_tokens: 2 } } });
    expect(acc.toTokenUsage().map((r) => r.model).sort()).toEqual(["a", "b"]);
  });
});
