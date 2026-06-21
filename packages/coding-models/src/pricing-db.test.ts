import { describe, it, expect } from "vitest";
import { rowToPricing, buildInsertParams, hasAnyRate, ratesEqual } from "./pricing-db.ts";
import type { ModelPricing } from "@journeyman/core";

describe("rowToPricing", () => {
  it("maps snake_case columns to a ModelPricing", () => {
    const p = rowToPricing({
      id: "mp_1", org_id: "org1", provider: "claude", vendor: "anthropic", model: "claude-opus-4-8",
      input_per_1m: "15.0000", output_per_1m: "75.0000", cache_read_per_1m: "1.5000",
      cache_creation_per_1m: "18.7500", reasoning_per_1m: null, currency: "USD",
      effective_from: "2026-06-01T00:00:00Z", effective_to: null,
      created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z",
    });
    expect(p.inputPer1m).toBe(15);
    expect(p.reasoningPer1m).toBeNull();
    expect(p.vendor).toBe("anthropic");
    expect(p.effectiveTo).toBeNull();
  });
});

describe("buildInsertParams", () => {
  it("defaults currency and numeric rates", () => {
    const { params } = buildInsertParams("org1", { provider: "claude", model: "x" });
    // params: [id, orgId, provider, vendor, model, input, output, cacheRead, cacheCreate, reasoning, currency, effectiveFrom]
    expect(params[1]).toBe("org1");
    expect(params[2]).toBe("claude");
    expect(params[10]).toBe("USD");
  });
});

describe("hasAnyRate", () => {
  it("is false for undefined or all-empty", () => {
    expect(hasAnyRate(undefined)).toBe(false);
    expect(hasAnyRate({})).toBe(false);
    expect(hasAnyRate({ inputPer1m: null, outputPer1m: undefined })).toBe(false);
  });
  it("is true when any rate is a number (including 0)", () => {
    expect(hasAnyRate({ inputPer1m: 0 })).toBe(true);
    expect(hasAnyRate({ outputPer1m: 75 })).toBe(true);
  });
});

describe("ratesEqual", () => {
  const active = {
    inputPer1m: 15, outputPer1m: 75, cacheReadPer1m: 1.5, cacheCreationPer1m: 18.75, reasoningPer1m: null,
  } as ModelPricing;
  it("treats matching rates as equal (ignores currency/effective dates)", () => {
    expect(ratesEqual(active, { inputPer1m: 15, outputPer1m: 75, cacheReadPer1m: 1.5, cacheCreationPer1m: 18.75, reasoningPer1m: null })).toBe(true);
  });
  it("detects a changed rate", () => {
    expect(ratesEqual(active, { inputPer1m: 16, outputPer1m: 75, cacheReadPer1m: 1.5, cacheCreationPer1m: 18.75, reasoningPer1m: null })).toBe(false);
  });
  it("treats undefined input rate as unchanged from null active rate", () => {
    expect(ratesEqual(active, { inputPer1m: 15, outputPer1m: 75, cacheReadPer1m: 1.5, cacheCreationPer1m: 18.75 })).toBe(true);
  });
});
