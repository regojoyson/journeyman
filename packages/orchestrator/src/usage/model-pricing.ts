import type { Pool } from "pg";

export interface PriceRates {
  inputPer1m: number | null;
  outputPer1m: number | null;
  cacheReadPer1m: number | null;
  cacheCreationPer1m: number | null;
  reasoningPer1m: number | null;
}

export interface CostTokens {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheCreationTokens?: number | null;
  reasoningTokens?: number | null;
}

/**
 * Dollar cost for one usage row. Returns null when the price row has no rates at all
 * (so the caller stores NULL = "unpriced"). A null individual rate counts as 0.
 */
export function computeCostUsd(rates: PriceRates, t: CostTokens): number | null {
  const allNull =
    rates.inputPer1m === null && rates.outputPer1m === null && rates.cacheReadPer1m === null &&
    rates.cacheCreationPer1m === null && rates.reasoningPer1m === null;
  if (allNull) return null;
  const per = (tokens: number | null | undefined, rate: number | null) =>
    ((tokens ?? 0) / 1_000_000) * (rate ?? 0);
  return (
    per(t.inputTokens, rates.inputPer1m) +
    per(t.outputTokens, rates.outputPer1m) +
    per(t.cacheReadTokens, rates.cacheReadPer1m) +
    per(t.cacheCreationTokens, rates.cacheCreationPer1m) +
    per(t.reasoningTokens, rates.reasoningPer1m)
  );
}

/**
 * The currently-active price (effective_to IS NULL) for (org, provider, model), or null.
 * Used at write time. Self-contained SQL — orchestrator owns its jm_* queries.
 */
export async function resolveActivePrice(
  pool: Pool, orgId: string | null, provider: string, model: string | null,
): Promise<PriceRates | null> {
  if (!orgId || !model) return null;
  const { rows } = await pool.query(
    `SELECT input_per_1m, output_per_1m, cache_read_per_1m, cache_creation_per_1m, reasoning_per_1m
     FROM jm_model_pricing
     WHERE org_id = $1 AND provider = $2 AND model = $3 AND effective_to IS NULL
     LIMIT 1`,
    [orgId, provider, model],
  );
  if (!rows[0]) return null;
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    inputPer1m: n(rows[0].input_per_1m), outputPer1m: n(rows[0].output_per_1m),
    cacheReadPer1m: n(rows[0].cache_read_per_1m), cacheCreationPer1m: n(rows[0].cache_creation_per_1m),
    reasoningPer1m: n(rows[0].reasoning_per_1m),
  };
}
