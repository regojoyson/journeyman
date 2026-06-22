import { describe, it, expect } from "vitest";
import type { UsageSummary, UsageBreakdownRow, UsageTimeseriesPoint } from "@journeyman/core";
import { tokenMixSegments, cumulativeSpend, costShareSegments } from "./usage-charts.ts";

function row(label: string, costUsd: number | null): UsageBreakdownRow {
  return {
    key: label, label, costUsd, totalTokens: 0, runs: 1,
    costPerRun: costUsd, cacheReadHitRatio: 0, firstSeen: null,
  };
}
function pt(day: string, costUsd: number | null): UsageTimeseriesPoint {
  return { day, costUsd, totalTokens: 0 };
}

const base: UsageSummary = {
  rows: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
  cacheCreationTokens: 0, reasoningTokens: 0, totalTokens: 0,
  costUsd: 0, unpricedRows: 0, runs: 0, costPerRun: 0,
  cacheReadHitRatio: 0, cacheSavingsUsd: 0,
  previous: {
    rows: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    cacheCreationTokens: 0, reasoningTokens: 0, totalTokens: 0,
    costUsd: 0, unpricedRows: 0, runs: 0,
  },
};

describe("tokenMixSegments", () => {
  it("returns [] for null summary", () => expect(tokenMixSegments(null)).toEqual([]));

  it("returns [] when every bucket is zero", () =>
    expect(tokenMixSegments(base)).toEqual([]));

  it("drops zero buckets and keeps non-zero ones in order", () => {
    const segs = tokenMixSegments({ ...base, inputTokens: 1500, outputTokens: 500 });
    expect(segs.map((s) => s.label)).toEqual(["Input", "Output"]);
  });

  it("formats values as token strings", () => {
    const [seg] = tokenMixSegments({ ...base, inputTokens: 90_000 });
    expect(seg.valueText).toBe("90.0K");
    expect(seg.value).toBe(90_000);
  });

  it("assigns a distinct color to each bucket", () => {
    const segs = tokenMixSegments({
      ...base, inputTokens: 1, outputTokens: 1, cacheReadTokens: 1,
      cacheCreationTokens: 1, reasoningTokens: 1,
    });
    expect(new Set(segs.map((s) => s.color)).size).toBe(5);
  });
});

describe("cumulativeSpend", () => {
  it("returns [] for empty series", () => expect(cumulativeSpend([])).toEqual([]));

  it("accumulates cost across days", () => {
    const pts = cumulativeSpend([pt("d1", 1), pt("d2", 2), pt("d3", 3)]);
    expect(pts.map((p) => p.value)).toEqual([1, 3, 6]);
  });

  it("treats null cost as zero", () => {
    const pts = cumulativeSpend([pt("d1", 2), pt("d2", null), pt("d3", 1)]);
    expect(pts.map((p) => p.value)).toEqual([2, 2, 3]);
  });
});

describe("costShareSegments", () => {
  it("returns [] when nothing is priced", () =>
    expect(costShareSegments([row("a", null), row("b", 0)])).toEqual([]));

  it("sorts by cost descending and shows percent of total", () => {
    const segs = costShareSegments([row("a", 25), row("b", 75)]);
    expect(segs.map((s) => s.label)).toEqual(["b", "a"]);
    expect(segs[0].valueText).toContain("75%");
  });

  it("rolls overflow groups into an Other slice", () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(`g${i}`, 10 - i));
    const segs = costShareSegments(rows, 6);
    expect(segs).toHaveLength(7);
    expect(segs[6].label).toBe("Other (3)");
    expect(segs[6].value).toBe(4 + 3 + 2);
  });
});
