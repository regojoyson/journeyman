import type { Pool } from "pg";
import { createLogger } from "@journeyman/core";

const log = createLogger("agent-alerts");

export type AlertKind = "failure_rate" | "stuck_run" | "near_daily_cap";

export interface Alert {
  kind: AlertKind;
  agentId: string;
  orgId: string;
  detail: Record<string, unknown>;
}

export interface AlertThresholds {
  /** Min runs today before failure-rate is meaningful. */
  minRuns: number;
  /** Failure fraction (0..1) that trips the alert. */
  failRate: number;
  /** A run "running" longer than this (ms) is considered stuck. */
  stuckMs: number;
  /** Fraction (0..1) of the daily cap that trips the near-cap alert. */
  nearCapFraction: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  minRuns: 5,
  failRate: 0.5,
  stuckMs: 2 * 60 * 60 * 1000, // 2h
  nearCapFraction: 0.8,
};

/**
 * Evaluate threshold rules over today's runs/counters and return tripped alerts.
 * Emits a structured log line per alert (delivery to a notification channel is a
 * thin follow-up — there is no org-level alert channel in the model yet). Each
 * rule is independent; a failing rule logs and is skipped, never throws.
 */
export async function evaluateAlerts(pool: Pool, t: AlertThresholds = DEFAULT_THRESHOLDS): Promise<Alert[]> {
  const alerts: Alert[] = [];

  // 1. Failure rate — per agent, today's terminal runs.
  try {
    const { rows } = await pool.query(
      `SELECT inputs->>'agentId' AS agent_id,
              count(*) FILTER (WHERE status IN ('completed','failed'))::int AS total,
              count(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM jm_workflow_instances
        WHERE inputs ? 'agentId' AND started_at >= CURRENT_DATE
        GROUP BY 1`,
    );
    for (const r of rows as Array<{ agent_id: string; total: number; failed: number }>) {
      if (r.total >= t.minRuns && r.failed / r.total >= t.failRate) {
        alerts.push({
          kind: "failure_rate",
          agentId: r.agent_id,
          orgId: "",
          detail: { total: r.total, failed: r.failed, rate: Number((r.failed / r.total).toFixed(2)) },
        });
      }
    }
  } catch (err) {
    log.error({ err }, "failure_rate rule failed");
  }

  // 2. Stuck runs — still 'running' past the threshold.
  try {
    const { rows } = await pool.query(
      `SELECT id, inputs->>'agentId' AS agent_id,
              EXTRACT(EPOCH FROM (now() - started_at)) * 1000 AS age_ms
         FROM jm_workflow_instances
        WHERE inputs ? 'agentId' AND status = 'running'
          AND started_at < now() - make_interval(secs => $1)`,
      [t.stuckMs / 1000],
    );
    for (const r of rows as Array<{ id: string; agent_id: string; age_ms: number }>) {
      alerts.push({
        kind: "stuck_run",
        agentId: r.agent_id,
        orgId: "",
        detail: { workflowInstanceId: r.id, ageMs: Math.round(Number(r.age_ms)) },
      });
    }
  } catch (err) {
    log.error({ err }, "stuck_run rule failed");
  }

  // 3. Near daily cap — today's run count vs the effective cap (agent override → org default).
  try {
    const { rows } = await pool.query(
      `SELECT c.agent_id, c.org_id, c.runs,
              COALESCE((a.definition->'limits'->>'dailyRunCap')::int, s.daily_run_cap) AS cap
         FROM jm_agent_run_counters c
         JOIN jm_agents a ON a.id = c.agent_id
         LEFT JOIN jm_org_agent_settings s ON s.org_id = c.org_id
        WHERE c.day = CURRENT_DATE`,
    );
    for (const r of rows as Array<{ agent_id: string; org_id: string; runs: number; cap: number | null }>) {
      if (r.cap != null && r.cap > 0 && r.runs >= r.cap * t.nearCapFraction) {
        alerts.push({
          kind: "near_daily_cap",
          agentId: r.agent_id,
          orgId: r.org_id,
          detail: { runs: r.runs, cap: r.cap },
        });
      }
    }
  } catch (err) {
    log.error({ err }, "near_daily_cap rule failed");
  }

  for (const a of alerts) log.warn({ alert: a.kind, agentId: a.agentId, orgId: a.orgId, ...a.detail }, "agent alert");
  return alerts;
}
