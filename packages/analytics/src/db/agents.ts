import type { Pool } from "pg";
import type {
  AgentStats, AgentInventory, DayCount, AgentLeaderboardRow,
} from "@journeyman/core";

export async function agentStats(pool: Pool, wsId: string, since: Date): Promise<AgentStats> {
  return {
    inventory: await inventory(pool, wsId),
    providerMix: await providerMix(pool, wsId, since),
    activityPerDay: await activityPerDay(pool, wsId, since),
    leaderboard: await leaderboard(pool, wsId, since),
  };
}

async function inventory(pool: Pool, wsId: string): Promise<AgentInventory> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'active')::int AS active,
            count(*) FILTER (WHERE status = 'draft')::int AS draft,
            count(*) FILTER (WHERE enabled)::int AS enabled
       FROM jm_agents
      WHERE workspace_id = $1`,
    [wsId],
  );
  const r = rows[0] ?? {};
  return { total: r.total ?? 0, active: r.active ?? 0, draft: r.draft ?? 0, enabled: r.enabled ?? 0 };
}

async function providerMix(pool: Pool, wsId: string, since: Date): Promise<Record<string, number>> {
  const { rows } = await pool.query(
    `SELECT provider, count(DISTINCT workflow_instance_id)::int AS n
       FROM jm_token_usage
      WHERE workspace_id = $1 AND created_at >= $2 AND agent_id IS NOT NULL
      GROUP BY provider`,
    [wsId, since],
  );
  const total = rows.reduce((s, r) => s + r.n, 0);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.provider] = total === 0 ? 0 : r.n / total;
  return out;
}

async function activityPerDay(pool: Pool, wsId: string, since: Date): Promise<DayCount[]> {
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            count(DISTINCT workflow_instance_id)::int AS n
       FROM jm_token_usage
      WHERE workspace_id = $1 AND created_at >= $2 AND agent_id IS NOT NULL
      GROUP BY 1 ORDER BY 1`,
    [wsId, since],
  );
  return rows.map((r) => ({ day: r.day, count: r.n }));
}

async function leaderboard(pool: Pool, wsId: string, since: Date): Promise<AgentLeaderboardRow[]> {
  // runs / success / duration from instances (agent id lives in inputs->>'agentId')
  const instRes = await pool.query(
    `SELECT inputs->>'agentId' AS agent_id,
            count(*)::int AS runs,
            count(*) FILTER (WHERE status = 'completed')::int AS completed,
            COALESCE(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL), 0)::bigint AS avg_dur
       FROM jm_workflow_instances
      WHERE workspace_id = $1 AND created_at >= $2 AND inputs->>'agentId' IS NOT NULL
      GROUP BY 1`,
    [wsId, since],
  );
  // tokens + provider from token usage
  const tokRes = await pool.query(
    `SELECT agent_id,
            COALESCE(SUM(total_tokens), 0)::bigint AS tokens,
            (array_agg(provider ORDER BY created_at DESC))[1] AS provider
       FROM jm_token_usage
      WHERE workspace_id = $1 AND created_at >= $2 AND agent_id IS NOT NULL
      GROUP BY agent_id`,
    [wsId, since],
  );
  // names
  const nameRes = await pool.query(
    `SELECT id, name FROM jm_agents WHERE workspace_id = $1`,
    [wsId],
  );

  const tokens = new Map<string, { tokens: number; provider: string | null }>();
  for (const r of tokRes.rows) tokens.set(r.agent_id, { tokens: Number(r.tokens), provider: r.provider ?? null });
  const names = new Map<string, string>();
  for (const r of nameRes.rows) names.set(r.id, r.name);

  const out: AgentLeaderboardRow[] = instRes.rows.map((r) => {
    const agentId = r.agent_id as string;
    const tk = tokens.get(agentId);
    return {
      agentId,
      name: names.get(agentId) ?? agentId,
      provider: tk?.provider ?? null,
      runs: r.runs,
      tokens: tk?.tokens ?? 0,
      successRate: r.runs === 0 ? 0 : r.completed / r.runs,
      avgDurationMs: Number(r.avg_dur),
    };
  });
  out.sort((a, b) => b.runs - a.runs);
  return out.slice(0, 10);
}
