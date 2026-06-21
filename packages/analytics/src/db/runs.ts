import type { Pool } from "pg";
import type { DayCount, OutcomeSplit, DurationStat, FailurePoint } from "@journeyman/core";

export async function runVolume(pool: Pool, wsId: string, since: Date): Promise<DayCount[]> {
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS n
       FROM jm_workflow_instances
      WHERE workspace_id = $1 AND created_at >= $2
      GROUP BY 1 ORDER BY 1`,
    [wsId, since],
  );
  return rows.map((r) => ({ day: r.day, count: r.n }));
}

export async function outcomeSplit(pool: Pool, wsId: string, since: Date): Promise<OutcomeSplit> {
  const { rows } = await pool.query(
    `SELECT status, count(*)::int AS n
       FROM jm_workflow_instances
      WHERE workspace_id = $1 AND created_at >= $2
        AND status IN ('completed','failed','cancelled')
      GROUP BY status`,
    [wsId, since],
  );
  const by: Record<string, number> = {};
  for (const r of rows) by[r.status] = r.n;
  const completed = by.completed ?? 0;
  const failed = by.failed ?? 0;
  const cancelled = by.cancelled ?? 0;
  const denom = completed + failed + cancelled;
  return { completed, failed, cancelled, successRate: denom === 0 ? 0 : completed / denom };
}

export async function durationStat(pool: Pool, wsId: string, since: Date): Promise<DurationStat> {
  const trendRes = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::bigint AS median
       FROM jm_workflow_instances
      WHERE workspace_id = $1 AND created_at >= $2 AND duration_ms IS NOT NULL
      GROUP BY 1 ORDER BY 1`,
    [wsId, since],
  );
  const trend = trendRes.rows.map((r) => ({ day: r.day, medianMs: Number(r.median) }));

  const overallRes = await pool.query(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::bigint AS median
       FROM jm_workflow_instances
      WHERE workspace_id = $1 AND created_at >= $2 AND duration_ms IS NOT NULL`,
    [wsId, since],
  );
  const medianMs = Number(overallRes.rows[0]?.median ?? 0);

  let deltaPct = 0;
  if (trend.length >= 2) {
    const first = trend[0].medianMs;
    const last = trend[trend.length - 1].medianMs;
    if (first > 0) deltaPct = (last - first) / first;
  }
  return { medianMs, trend, deltaPct };
}

export async function byTrigger(pool: Pool, wsId: string, since: Date): Promise<Record<string, number>> {
  const { rows } = await pool.query(
    `SELECT trigger_source, count(*)::int AS n
       FROM jm_workflow_instances
      WHERE workspace_id = $1 AND created_at >= $2
      GROUP BY trigger_source`,
    [wsId, since],
  );
  const total = rows.reduce((s, r) => s + r.n, 0);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.trigger_source] = total === 0 ? 0 : r.n / total;
  return out;
}

export async function topFailures(pool: Pool, wsId: string, since: Date): Promise<FailurePoint[]> {
  const { rows } = await pool.query(
    `SELECT failed_at_node_id AS node_id, count(*)::int AS n
       FROM jm_workflow_instances
      WHERE workspace_id = $1 AND created_at >= $2
        AND status = 'failed' AND failed_at_node_id IS NOT NULL
      GROUP BY failed_at_node_id
      ORDER BY n DESC
      LIMIT 5`,
    [wsId, since],
  );
  return rows.map((r) => ({ nodeId: r.node_id ?? null, count: r.n }));
}
