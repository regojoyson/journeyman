import { describe, it, expect } from "vitest";
import type { UsageSummary } from "@journeyman/core";
import { tokenMixSegments } from "./usage-charts.ts";

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
