import type { Pool } from "pg";
import type {
  UsageSummary, UsageTotals, UsageTimeseriesPoint, UsageBreakdownRow,
  UsageWaste, UsageInstanceDetail, UsageDimensionKey,
} from "@journeyman/core";

/**
 * Per dashboard dimension: `group` is the GROUP BY column list, `label` is the
 * SQL expression used as the human-readable bar label. Whitelisted — never
 * interpolate caller input.
 *
 * `label` is a COALESCE chain so a null name never renders as a bare "—":
 * agent/workflow fall back to the stored name, then a resolved name (agents are
 * looked up in jm_agents by id), then the id text. The JS mapper applies the
 * final "—" only when every column is null (e.g. usage not tied to an agent).
 */
export const DIMENSION_SQL: Record<UsageDimensionKey, { group: string; label: string }> = {
  model: { group: "provider, model", label: "COALESCE(model, provider)" },
  provider: { group: "provider", label: "provider" },
  agent: {
    group: "agent_id, agent_name",
    label:
      "COALESCE(agent_name, (SELECT a.name FROM jm_agents a WHERE a.id = jm_token_usage.agent_id), agent_id::text)",
  },
  workflow: {
    group: "workflow_id, workflow_name",
    label: "COALESCE(workflow_name, workflow_id::text)",
  },
  workflow_version: { group: "workflow_version_id", label: "workflow_version_id::text" },
  step: { group: "step_type", label: "step_type" },
};

export function costPerRun(cost: number | null, runs: number): number | null {
  if (cost === null || runs <= 0) return null;
  return cost / runs;
}

export function cacheReadHitRatio(cacheRead: number, input: number): number {
  const denom = cacheRead + input;
  return denom <= 0 ? 0 : cacheRead / denom;
}

const TOTALS_COLS = `
  COUNT(*)::int AS rows,
  COUNT(DISTINCT workflow_instance_id)::int AS runs,
  COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
  COALESCE(SUM(output_tokens),0)::bigint AS output_tokens,
  COALESCE(SUM(cache_read_tokens),0)::bigint AS cache_read_tokens,
  COALESCE(SUM(cache_creation_tokens),0)::bigint AS cache_creation_tokens,
  COALESCE(SUM(reasoning_tokens),0)::bigint AS reasoning_tokens,
  COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
  SUM(cost_usd) AS cost_usd,
  COUNT(*) FILTER (WHERE cost_usd IS NULL)::int AS unpriced_rows`;

function rowToTotals(r: any): UsageTotals & { runs: number } {
  return {
    rows: Number(r.rows), runs: Number(r.runs),
    inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens),
    cacheReadTokens: Number(r.cache_read_tokens), cacheCreationTokens: Number(r.cache_creation_tokens),
    reasoningTokens: Number(r.reasoning_tokens), totalTokens: Number(r.total_tokens),
    costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
    unpricedRows: Number(r.unpriced_rows),
  };
}

async function totalsBetween(pool: Pool, wsId: string, from: Date, to: Date) {
  const { rows } = await pool.query(
    `SELECT ${TOTALS_COLS} FROM jm_token_usage
     WHERE workspace_id = $1 AND created_at >= $2 AND created_at < $3`,
    [wsId, from, to],
  );
  return rowToTotals(rows[0]);
}

export async function usageSummary(
  pool: Pool, wsId: string, since: Date, now: Date,
): Promise<UsageSummary> {
  const cur = await totalsBetween(pool, wsId, since, now);
  const prevSpan = now.getTime() - since.getTime();
  const prevFrom = new Date(since.getTime() - prevSpan);
  const prev = await totalsBetween(pool, wsId, prevFrom, since);
  return {
    ...cur,
    costPerRun: costPerRun(cur.costUsd, cur.runs),
    cacheReadHitRatio: cacheReadHitRatio(cur.cacheReadTokens, cur.inputTokens),
    // Dollar savings need a per-model input-vs-cache-read rate spread (lost after aggregation).
    // v1 reports cacheReadHitRatio instead. Kept null so the field stays present.
    cacheSavingsUsd: null,
    previous: prev,
  };
}

export async function usageTimeseries(
  pool: Pool, wsId: string, since: Date,
): Promise<UsageTimeseriesPoint[]> {
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            SUM(cost_usd) AS cost_usd,
            COALESCE(SUM(total_tokens),0)::bigint AS total_tokens
     FROM jm_token_usage
     WHERE workspace_id = $1 AND created_at >= $2
     GROUP BY 1 ORDER BY 1`,
    [wsId, since],
  );
  return rows.map((r) => ({
    day: r.day, costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
    totalTokens: Number(r.total_tokens),
  }));
}

export async function usageByDimension(
  pool: Pool, wsId: string, since: Date, dimension: UsageDimensionKey,
): Promise<UsageBreakdownRow[]> {
  const cfg = DIMENSION_SQL[dimension];
  if (!cfg) throw new Error(`unknown dimension: ${dimension}`);
  const { rows } = await pool.query(
    `SELECT ${cfg.label} AS gk,
            COUNT(DISTINCT workflow_instance_id)::int AS runs,
            COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
            COALESCE(SUM(cache_read_tokens),0)::bigint AS cache_read_tokens,
            COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
            SUM(cost_usd) AS cost_usd,
            MIN(created_at) AS first_seen
     FROM jm_token_usage
     WHERE workspace_id = $1 AND created_at >= $2
     GROUP BY ${cfg.group} ORDER BY cost_usd DESC NULLS LAST, total_tokens DESC`,
    [wsId, since],
  );
  return rows.map((r) => {
    const cost = r.cost_usd === null ? null : Number(r.cost_usd);
    const runs = Number(r.runs);
    return {
      key: String(r.gk ?? "—"),
      label: String(r.gk ?? "—"),
      costUsd: cost, totalTokens: Number(r.total_tokens), runs,
      costPerRun: costPerRun(cost, runs),
      cacheReadHitRatio: cacheReadHitRatio(Number(r.cache_read_tokens), Number(r.input_tokens)),
      firstSeen: r.first_seen ? new Date(r.first_seen).toISOString() : null,
    };
  });
}

export async function usageWaste(pool: Pool, wsId: string, since: Date): Promise<UsageWaste> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
            COUNT(*)::int AS rows, SUM(cost_usd) AS cost_usd
     FROM jm_token_usage
     WHERE workspace_id = $1 AND created_at >= $2 AND (outcome <> 'success' OR attempt > 1)`,
    [wsId, since],
  );
  const totalCostRow = await pool.query(
    `SELECT SUM(cost_usd) AS cost_usd FROM jm_token_usage WHERE workspace_id = $1 AND created_at >= $2`,
    [wsId, since],
  );
  const topAgentRow = await pool.query(
    `SELECT agent_id, agent_name, SUM(cost_usd) AS cost_usd
     FROM jm_token_usage
     WHERE workspace_id = $1 AND created_at >= $2 AND (outcome <> 'success' OR attempt > 1)
     GROUP BY agent_id, agent_name ORDER BY cost_usd DESC NULLS LAST LIMIT 1`,
    [wsId, since],
  );
  const wasteCost = rows[0].cost_usd === null ? null : Number(rows[0].cost_usd);
  const totalCost = totalCostRow.rows[0].cost_usd === null ? null : Number(totalCostRow.rows[0].cost_usd);
  const ta = topAgentRow.rows[0];
  return {
    costUsd: wasteCost, totalTokens: Number(rows[0].total_tokens), rows: Number(rows[0].rows),
    fractionOfTotalCost: wasteCost !== null && totalCost && totalCost > 0 ? wasteCost / totalCost : null,
    topAgent: ta ? { agentId: ta.agent_id ?? null, agentName: ta.agent_name ?? null,
      costUsd: ta.cost_usd === null ? null : Number(ta.cost_usd) } : null,
  };
}

export async function usageInstance(
  pool: Pool, wsId: string, instanceId: string,
): Promise<UsageInstanceDetail> {
  const { rows } = await pool.query(
    `SELECT node_id, step_type, step_name, attempt, outcome, model,
            COALESCE(SUM(total_tokens),0)::bigint AS total_tokens, SUM(cost_usd) AS cost_usd
     FROM jm_token_usage
     WHERE workspace_id = $1 AND workflow_instance_id = $2
     GROUP BY node_id, step_type, step_name, attempt, outcome, model
     ORDER BY cost_usd DESC NULLS LAST`,
    [wsId, instanceId],
  );
  const steps = rows.map((r) => ({
    nodeId: r.node_id, stepType: r.step_type, stepName: r.step_name ?? null,
    attempt: Number(r.attempt), outcome: r.outcome, model: r.model ?? null,
    totalTokens: Number(r.total_tokens), costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
  }));
  const costUsd = steps.some((s) => s.costUsd !== null)
    ? steps.reduce((a, s) => a + (s.costUsd ?? 0), 0) : null;
  return {
    instanceId, costUsd,
    totalTokens: steps.reduce((a, s) => a + s.totalTokens, 0), steps,
  };
}
