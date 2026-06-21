import { describe, it, expect } from "vitest";
import { activePriceFor } from "./coding-model-pricing.ts";
import type { ModelPricing } from "@journeyman/core";

const row = (over: Partial<ModelPricing>): ModelPricing => ({
  id: "mp", orgId: "o", provider: "claude", vendor: undefined, model: "claude-opus-4-8",
  inputPer1m: 15, outputPer1m: 75, cacheReadPer1m: null, cacheCreationPer1m: null, reasoningPer1m: null,
  currency: "USD", effectiveFrom: "2026-06-01T00:00:00Z", effectiveTo: null,
  createdAt: "", updatedAt: "", ...over,
});

describe("activePriceFor", () => {
  it("returns the active row matching provider+model as a ModelPriceInput", () => {
    const p = activePriceFor([row({})], "claude", "claude-opus-4-8");
    expect(p).toEqual({ inputPer1m: 15, outputPer1m: 75, cacheReadPer1m: null, cacheCreationPer1m: null, reasoningPer1m: null, currency: "USD" });
  });
  it("ignores superseded (effectiveTo set) rows", () => {
    const p = activePriceFor([row({ effectiveTo: "2026-06-10T00:00:00Z", inputPer1m: 99 })], "claude", "claude-opus-4-8");
    expect(p).toBeNull();
  });
  it("returns null when nothing matches", () => {
    expect(activePriceFor([row({})], "claude", "other-model")).toBeNull();
  });
});
