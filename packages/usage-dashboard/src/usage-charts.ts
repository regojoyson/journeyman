import type { UsageSummary } from "@journeyman/core";
import { COLORS } from "./widgets.tsx";
import { formatTokens } from "./format.ts";

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
  valueText: string;
}

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
