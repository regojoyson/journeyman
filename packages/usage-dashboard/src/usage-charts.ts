import type { UsageSummary, UsageTimeseriesPoint, UsageBreakdownRow } from "@journeyman/core";
import { COLORS } from "./widgets.tsx";
import { formatTokens, formatUsd } from "./format.ts";

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
  valueText: string;
}

/** Repeating palette for category donuts (cost share by model/agent/etc.). */
const PALETTE = [COLORS.BLUE, COLORS.GREEN, COLORS.AMBER, COLORS.PURPLE, COLORS.RED];
const OTHER_COLOR = "#8a8a8a";

/**
 * Break a usage summary's token total into its composition (input / output /
 * cache / reasoning) for the "Token mix" donut. Zero-value buckets are dropped
 * so the chart and legend stay clean; returns [] when there's no summary or no
 * tokens at all.
 */
export function tokenMixSegments(s: UsageSummary | null): DonutSegment[] {
  if (!s) return [];
  const parts = [
    { label: "Input", value: s.inputTokens, color: COLORS.BLUE },
    { label: "Output", value: s.outputTokens, color: COLORS.GREEN },
    { label: "Cache read", value: s.cacheReadTokens, color: COLORS.AMBER },
    { label: "Cache write", value: s.cacheCreationTokens, color: COLORS.PURPLE },
    { label: "Reasoning", value: s.reasoningTokens, color: COLORS.RED },
  ];
  return parts
    .filter((p) => p.value > 0)
    .map((p) => ({ ...p, valueText: formatTokens(p.value) }));
}

/**
 * Running-total spend across the window — the budget-burn line. Each point is
 * the cumulative cost up to and including that day.
 */
export function cumulativeSpend(ts: UsageTimeseriesPoint[]): { value: number; title: string }[] {
  let acc = 0;
  return ts.map((t) => {
    acc += t.costUsd ?? 0;
    return { value: acc, title: `${t.day} · ${formatUsd(acc)} cumulative` };
  });
}

/**
 * Cost-share donut by group (model / agent / …). Keeps the top `topN` priced
 * groups and rolls the remainder into an "Other" slice. Each segment's label
 * shows its dollar amount and percent of total. Unpriced/zero rows are dropped;
 * returns [] when nothing is priced.
 */
export function costShareSegments(rows: UsageBreakdownRow[], topN = 6): DonutSegment[] {
  const priced = rows
    .filter((r) => (r.costUsd ?? 0) > 0)
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));
  if (priced.length === 0) return [];

  const total = priced.reduce((a, r) => a + (r.costUsd ?? 0), 0);
  const pct = (v: number) => Math.round((v / total) * 100);
  const fmt = (v: number) => `${formatUsd(v)} · ${pct(v)}%`;

  const top = priced.slice(0, topN);
  const rest = priced.slice(topN);
  const segs: DonutSegment[] = top.map((r, i) => ({
    label: r.label,
    value: r.costUsd ?? 0,
    color: PALETTE[i % PALETTE.length],
    valueText: fmt(r.costUsd ?? 0),
  }));

  if (rest.length > 0) {
    const restCost = rest.reduce((a, r) => a + (r.costUsd ?? 0), 0);
    segs.push({ label: `Other (${rest.length})`, value: restCost, color: OTHER_COLOR, valueText: fmt(restCost) });
  }
  return segs;
}
