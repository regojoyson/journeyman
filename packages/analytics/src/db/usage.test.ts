import { describe, it, expect } from "vitest";
import { DIMENSION_SQL, costPerRun, cacheReadHitRatio } from "./usage.ts";

describe("DIMENSION_SQL whitelist", () => {
  it("maps known dimensions and omits unknown ones", () => {
    expect(DIMENSION_SQL.model).toBe("provider, model");
    expect(DIMENSION_SQL.agent).toContain("agent_id");
    expect((DIMENSION_SQL as Record<string, string>).bogus).toBeUndefined();
  });
});

describe("derivations", () => {
  it("costPerRun divides cost by runs, null when no runs or no cost", () => {
    expect(costPerRun(100, 50)).toBe(2);
    expect(costPerRun(null, 50)).toBeNull();
    expect(costPerRun(100, 0)).toBeNull();
  });
  it("cacheReadHitRatio = cacheRead / (cacheRead + input)", () => {
    expect(cacheReadHitRatio(75, 25)).toBeCloseTo(0.75, 6);
    expect(cacheReadHitRatio(0, 0)).toBe(0);
  });
});
