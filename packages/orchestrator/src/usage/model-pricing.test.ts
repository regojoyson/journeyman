import { describe, it, expect } from "vitest";
import { computeCostUsd, type PriceRates } from "./model-pricing.ts";

const rates: PriceRates = {
  inputPer1m: 15, outputPer1m: 75, cacheReadPer1m: 1.5, cacheCreationPer1m: 18.75, reasoningPer1m: 75,
};

describe("computeCostUsd", () => {
  it("sums each token type at its per-1M rate", () => {
    // 1M input @15 + 1M output @75 = 90
    const cost = computeCostUsd(rates, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(90, 6);
  });
  it("prices cache and reasoning tokens", () => {
    const cost = computeCostUsd(rates, { cacheReadTokens: 2_000_000, reasoningTokens: 1_000_000 });
    expect(cost).toBeCloseTo(3 + 75, 6);
  });
  it("treats null rates as zero", () => {
    const cost = computeCostUsd({ ...rates, inputPer1m: null }, { inputTokens: 1_000_000 });
    expect(cost).toBe(0);
  });
  it("returns null when no rate is set at all", () => {
    const cost = computeCostUsd(
      { inputPer1m: null, outputPer1m: null, cacheReadPer1m: null, cacheCreationPer1m: null, reasoningPer1m: null },
      { inputTokens: 1_000_000 },
    );
    expect(cost).toBeNull();
  });
});
