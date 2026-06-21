import { describe, it, expect } from "vitest";
import { detectVersionRegression } from "./regression.ts";

describe("detectVersionRegression", () => {
  it("flags the latest version when its $/run jumps over the threshold", () => {
    const r = detectVersionRegression([
      { label: "v3", costPerRun: 1.0 }, { label: "v4", costPerRun: 1.1 }, { label: "v5", costPerRun: 1.85 },
    ], 0.25);
    expect(r).toEqual({ regressed: true, latest: "v5", prior: "v4", increasePct: 68 });
  });
  it("does not flag a modest change", () => {
    const r = detectVersionRegression([{ label: "v4", costPerRun: 1.0 }, { label: "v5", costPerRun: 1.1 }], 0.25);
    expect(r.regressed).toBe(false);
  });
  it("returns regressed=false with fewer than two priced versions", () => {
    expect(detectVersionRegression([{ label: "v5", costPerRun: 1.0 }], 0.25).regressed).toBe(false);
  });
});
