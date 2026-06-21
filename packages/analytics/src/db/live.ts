import type { Pool } from "pg";
import type {
  LiveStats, ActiveRunsStat, NeedsAttentionItem, RecentFeedItem, ActiveSandboxesStat,
} from "@journeyman/core";

export async function getLiveStats(pool: Pool, wsId: string): Promise<LiveStats> {
  return {
    activeRuns: await activeRuns(pool, wsId),
    needsAttention: await needsAttention(pool, wsId),
    recentFeed: await recentFeed(pool, wsId),
    activeSandboxes: await activeSandboxes(pool, wsId),
  };
}

async function activeRuns(pool: Pool, wsId: string): Promise<ActiveRunsStat> {
  const { rows } = await pool.query(
    `SELECT status, count(*)::int AS n
       FROM jm_workflow_instances
      WHERE workspace_id = $1
        AND status IN ('running','pending','provisioning','paused')
      GROUP BY status`,
    [wsId],
  );
  const by: Record<string, number> = {};
  for (const r of rows) by[r.status] = r.n;
  const running = by.running ?? 0;
  const queued = (by.pending ?? 0) + (by.provisioning ?? 0);
  const paused = by.paused ?? 0;
  return { running, queued, paused, total: running + queued + paused };
}

async function needsAttention(pool: Pool, wsId: string): Promise<NeedsAttentionItem[]> {
  const { rows } = await pool.query(
    `SELECT id,
            COALESCE(workflow_name_snapshot, 'run') AS name,
            status,
            failed_at_node_id,
            (EXTRACT(EPOCH FROM (now() - COALESCE(completed_at, started_at, created_at))) * 1000)::bigint AS age_ms
       FROM jm_workflow_instances
      WHERE workspace_id = $1
        AND (status = 'paused'
             OR (status = 'failed' AND completed_at > now() - interval '1 hour'))
      ORDER BY COALESCE(completed_at, started_at, created_at) DESC
      LIMIT 20`,
    [wsId],
  );
  return rows.map((r) => ({
    instanceId: r.id,
    name: r.name,
    state: r.status as "paused" | "failed",
    nodeId: r.failed_at_node_id ?? null,
    ageMs: Number(r.age_ms),
  }));
}

async function recentFeed(pool: Pool, wsId: string): Promise<RecentFeedItem[]> {
  const { rows } = await pool.query(
    `SELECT id,
            COALESCE(workflow_name_snapshot, 'run') AS name,
            status,
            trigger_source,
            (EXTRACT(EPOCH FROM (COALESCE(completed_at, now()) - COALESCE(started_at, created_at))) * 1000)::bigint AS elapsed_ms
       FROM jm_workflow_instances
      WHERE workspace_id = $1
      ORDER BY created_at DESC
      LIMIT 10`,
    [wsId],
  );
  return rows.map((r) => ({
    instanceId: r.id,
    name: r.name,
    status: r.status,
    trigger: r.trigger_source,
    elapsedMs: Number(r.elapsed_ms),
  }));
}

async function activeSandboxes(pool: Pool, wsId: string): Promise<ActiveSandboxesStat> {
  const { rows } = await pool.query(
    `SELECT s.type, count(*)::int AS n
       FROM jm_sandbox_instances s
       JOIN jm_workflow_instances r ON s.run_id = r.id
      WHERE r.workspace_id = $1
        AND s.status = 'active'
      GROUP BY s.type`,
    [wsId],
  );
  const byType: Record<string, number> = {};
  let total = 0;
  for (const r of rows) { byType[r.type] = r.n; total += r.n; }
  return { total, byType };
}
