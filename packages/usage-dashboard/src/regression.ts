export interface VersionCost { label: string; costPerRun: number | null }
export interface RegressionResult {
  regressed: boolean; latest: string | null; prior: string | null; increasePct: number | null;
}

/** Flags when the most recent version's $/run exceeds the prior version's by `threshold` (fraction). */
export function detectVersionRegression(
  versions: VersionCost[], threshold: number,
): RegressionResult {
  const priced = versions.filter((v) => v.costPerRun !== null) as { label: string; costPerRun: number }[];
  if (priced.length < 2) return { regressed: false, latest: priced.at(-1)?.label ?? null, prior: null, increasePct: null };
  const latest = priced[priced.length - 1];
  const prior = priced[priced.length - 2];
  if (prior.costPerRun <= 0) return { regressed: false, latest: latest.label, prior: prior.label, increasePct: null };
  const inc = (latest.costPerRun - prior.costPerRun) / prior.costPerRun;
  return {
    regressed: inc > threshold, latest: latest.label, prior: prior.label, increasePct: Math.round(inc * 100),
  };
}
