import parser from "cron-parser";
import type { Pool } from "pg";
import type { Agent } from "@journeyman/core";
import { getAgent, runAgentGuarded, wasSkipped, type RunAgentDeps } from "@journeyman/agents";
import { evaluateAlerts } from "./agent-alerts.ts";

/** Next fire time for a cron expression in the given IANA timezone. */
export function nextRun(cron: string, timezone: string, from: Date = new Date()): Date {
  return parser.parseExpression(cron, { tz: timezone, currentDate: from }).next().toDate();
}

/** Upsert schedule state for an agent's schedule trigger (called on enable). Removes state if none. */
export async function syncScheduleState(pool: Pool, agent: Agent): Promise<void> {
  const schedule = agent.triggers.find((t) => t.type === "schedule") as
    | Extract<Agent["triggers"][number], { type: "schedule" }>
    | undefined;
  if (!schedule || !agent.enabled) {
    await pool.query(`DELETE FROM jm_agent_schedule_state WHERE agent_id = $1`, [agent.id]);
    return;
  }
  const due = nextRun(schedule.cron, schedule.timezone);
  await pool.query(
    `INSERT INTO jm_agent_schedule_state (agent_id, cron, timezone, next_due_at)
       VALUES ($1,$2,$3,$4)
     ON CONFLICT (agent_id) DO UPDATE SET cron = $2, timezone = $3, next_due_at = $4, updated_at = now()`,
    [agent.id, schedule.cron, schedule.timezone, due],
  );
}

export async function clearScheduleState(pool: Pool, agentId: string): Promise<void> {
  await pool.query(`DELETE FROM jm_agent_schedule_state WHERE agent_id = $1`, [agentId]);
}

/**
 * One scheduler pass. Atomically claims due schedules (UPDATE ... RETURNING) so
 * concurrent api-server instances never double-fire, then fires each + advances
 * next_due_at. Policy: skip missed fires (advance to the next upcoming time).
 */
export async function tickOnce(pool: Pool, deps: RunAgentDeps): Promise<number> {
  const { rows } = await pool.query(
    `UPDATE jm_agent_schedule_state
        SET last_fired_at = now(), updated_at = now()
      WHERE next_due_at <= now()
      RETURNING agent_id, cron, timezone`,
  );
  let fired = 0;
  for (const r of rows as Array<{ agent_id: string; cron: string; timezone: string }>) {
    try {
      const agent = await getAgent(pool, r.agent_id);
      if (agent && agent.enabled) {
        const schedule = agent.triggers.find((t) => t.type === "schedule") as
          | Extract<Agent["triggers"][number], { type: "schedule" }>
          | undefined;
        const inputs = (schedule?.fixedInputs ?? {}) as Record<string, unknown>;
        const res = await runAgentGuarded({ ...deps, pool }, agent, inputs, "schedule", {
          userId: null,
          orgId: agent.orgId,
        });
        if (!wasSkipped(res)) fired++;
      }
    } catch {
      // swallow — a bad agent shouldn't stall the tick
    } finally {
      await pool
        .query(`UPDATE jm_agent_schedule_state SET next_due_at = $2 WHERE agent_id = $1`, [
          r.agent_id,
          nextRun(r.cron, r.timezone),
        ])
        .catch(() => {});
    }
  }
  return fired;
}

/** Start the periodic scheduler; returns a stop function. Also evaluates alerts each tick. */
export function startAgentScheduler(pool: Pool, deps: RunAgentDeps, intervalMs = 60_000): () => void {
  const handle = setInterval(() => {
    void tickOnce(pool, deps).catch(() => {});
    void evaluateAlerts(pool).catch(() => {});
  }, intervalMs);
  return () => clearInterval(handle);
}
