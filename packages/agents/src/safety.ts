import type { Pool } from "pg";
import type { Agent, AgentSafetyLimits, AgentSkipReason, OrgAgentSettings } from "@journeyman/core";

/** Statuses that count as an in-flight run for concurrency. */
const ACTIVE_STATUSES = ["pending", "queued", "running", "waiting", "paused"];

const DEFAULT_SETTINGS = (orgId: string): OrgAgentSettings => ({
  orgId,
  paused: false,
  limits: {},
  updatedAt: new Date(0).toISOString(),
});

function rowToSettings(r: any): OrgAgentSettings {
  const budget = r.budget ?? undefined;
  return {
    orgId: r.org_id,
    paused: r.paused,
    limits: {
      maxConcurrentRuns: r.max_concurrent_runs ?? undefined,
      dailyRunCap: r.daily_run_cap ?? undefined,
      budget: budget ?? undefined,
    },
    updatedAt: r.updated_at,
  };
}

/** Org settings (kill-switch + default limits). Returns defaults when no row exists. */
export async function getOrgAgentSettings(pool: Pool, orgId: string): Promise<OrgAgentSettings> {
  const { rows } = await pool.query(`SELECT * FROM jm_org_agent_settings WHERE org_id = $1`, [orgId]);
  return rows[0] ? rowToSettings(rows[0]) : DEFAULT_SETTINGS(orgId);
}

export interface OrgAgentSettingsPatch {
  paused?: boolean;
  limits?: AgentSafetyLimits;
}

/** Upsert org settings; only provided fields are changed. */
export async function upsertOrgAgentSettings(
  pool: Pool,
  orgId: string,
  patch: OrgAgentSettingsPatch,
): Promise<OrgAgentSettings> {
  const current = await getOrgAgentSettings(pool, orgId);
  const paused = patch.paused ?? current.paused;
  const limits = patch.limits ?? current.limits;
  const { rows } = await pool.query(
    `INSERT INTO jm_org_agent_settings (org_id, paused, max_concurrent_runs, daily_run_cap, budget, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, now())
     ON CONFLICT (org_id) DO UPDATE SET
       paused = EXCLUDED.paused,
       max_concurrent_runs = EXCLUDED.max_concurrent_runs,
       daily_run_cap = EXCLUDED.daily_run_cap,
       budget = EXCLUDED.budget,
       updated_at = now()
     RETURNING *`,
    [
      orgId,
      paused,
      limits.maxConcurrentRuns ?? null,
      limits.dailyRunCap ?? null,
      limits.budget ? JSON.stringify(limits.budget) : null,
    ],
  );
  return rowToSettings(rows[0]);
}

/** Effective limit for a field: the per-agent override wins, else the org default. */
function effective<T>(agentVal: T | undefined, orgVal: T | undefined): T | undefined {
  return agentVal ?? orgVal;
}

export type SafetyVerdict = { ok: true } | { ok: false; reason: AgentSkipReason };

/**
 * Enforce the §15.1 safety rails before a run is submitted. Checked in order:
 * paused (org) → concurrency → daily cap → budget. Any tripped rail returns a
 * typed skip reason; callers translate it (e.g. API /fire → 429). Read-only.
 */
export async function enforceSafetyRails(pool: Pool, agent: Agent): Promise<SafetyVerdict> {
  const settings = await getOrgAgentSettings(pool, agent.orgId);

  // 1. Kill-switch
  if (settings.paused) return { ok: false, reason: "paused" };

  const agentLimits = agent.limits ?? {};
  const maxConcurrent = effective(agentLimits.maxConcurrentRuns, settings.limits.maxConcurrentRuns);
  const dailyCap = effective(agentLimits.dailyRunCap, settings.limits.dailyRunCap);
  const maxTokens = effective(agentLimits.budget?.maxTokens, settings.limits.budget?.maxTokens);
  const maxCostUsd = effective(agentLimits.budget?.maxCostUsd, settings.limits.budget?.maxCostUsd);

  // 2. Concurrency — count in-flight instances tagged with this agent.
  if (maxConcurrent != null) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM jm_workflow_instances
        WHERE inputs->>'agentId' = $1 AND status = ANY($2)`,
      [agent.id, ACTIVE_STATUSES],
    );
    if ((rows[0]?.n ?? 0) >= maxConcurrent) return { ok: false, reason: "concurrency" };
  }

  // 3 & 4. Daily cap + budget — today's per-agent counter.
  if (dailyCap != null || maxTokens != null || maxCostUsd != null) {
    const { rows } = await pool.query(
      `SELECT runs, tokens, cost_usd FROM jm_agent_run_counters
        WHERE agent_id = $1 AND day = CURRENT_DATE`,
      [agent.id],
    );
    const runs = Number(rows[0]?.runs ?? 0);
    const tokens = Number(rows[0]?.tokens ?? 0);
    const cost = Number(rows[0]?.cost_usd ?? 0);
    if (dailyCap != null && runs >= dailyCap) return { ok: false, reason: "daily_cap" };
    if (maxTokens != null && tokens >= maxTokens) return { ok: false, reason: "budget" };
    if (maxCostUsd != null && cost >= maxCostUsd) return { ok: false, reason: "budget" };
  }

  return { ok: true };
}

/** Bump today's run count for an agent (called on submit). */
export async function incrementRunCounter(pool: Pool, orgId: string, agentId: string): Promise<void> {
  await pool.query(
    `INSERT INTO jm_agent_run_counters (org_id, agent_id, day, runs)
     VALUES ($1, $2, CURRENT_DATE, 1)
     ON CONFLICT (agent_id, day) DO UPDATE SET runs = jm_agent_run_counters.runs + 1`,
    [orgId, agentId],
  );
}

/** Add token/cost usage to today's tally (called by the worker on terminal — 4c). */
export async function addUsage(
  pool: Pool,
  orgId: string,
  agentId: string,
  tokens: number,
  costUsd: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO jm_agent_run_counters (org_id, agent_id, day, tokens, cost_usd)
     VALUES ($1, $2, CURRENT_DATE, $3, $4)
     ON CONFLICT (agent_id, day) DO UPDATE SET
       tokens = jm_agent_run_counters.tokens + EXCLUDED.tokens,
       cost_usd = jm_agent_run_counters.cost_usd + EXCLUDED.cost_usd`,
    [orgId, agentId, Math.trunc(tokens), costUsd],
  );
}
