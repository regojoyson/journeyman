import type { Pool } from "pg";

export interface HumanTaskResolutionRow {
  id: string;
  runId: string;
  nodeId: string;
  outcome: string;
  comment: string | null;
  actor: string | null;
  source: "webhook" | "manual" | "timeout";
  webhookEventId: string | null;
  /** Fine-grained reason for audit: "node_timeout" | "max_age_sweep" | null. */
  resolvedBy: string | null;
  resolvedAt: Date;
}

export interface IHumanTaskResolutionStore {
  create(input: Omit<HumanTaskResolutionRow, "id" | "resolvedAt">): Promise<HumanTaskResolutionRow>;
  listForRun(runId: string): Promise<HumanTaskResolutionRow[]>;
  latestForNode(runId: string, nodeId: string): Promise<HumanTaskResolutionRow | null>;
}

export class PostgresHumanTaskResolutionStore implements IHumanTaskResolutionStore {
  constructor(private pool: Pool) {}

  async create(input: Omit<HumanTaskResolutionRow, "id" | "resolvedAt">): Promise<HumanTaskResolutionRow> {
    const r = await this.pool.query(
      `INSERT INTO jm_human_task_resolutions
         (run_id, node_id, outcome, comment, actor, source, webhook_event_id, resolved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, run_id, node_id, outcome, comment, actor, source, webhook_event_id, resolved_by, resolved_at`,
      [input.runId, input.nodeId, input.outcome, input.comment, input.actor, input.source, input.webhookEventId, input.resolvedBy ?? null],
    );
    return rowToObj(r.rows[0]);
  }

  async listForRun(runId: string): Promise<HumanTaskResolutionRow[]> {
    const r = await this.pool.query(
      `SELECT id, run_id, node_id, outcome, comment, actor, source, webhook_event_id, resolved_by, resolved_at
       FROM jm_human_task_resolutions WHERE run_id = $1 ORDER BY resolved_at ASC`,
      [runId],
    );
    return r.rows.map(rowToObj);
  }

  async latestForNode(runId: string, nodeId: string): Promise<HumanTaskResolutionRow | null> {
    const r = await this.pool.query(
      `SELECT id, run_id, node_id, outcome, comment, actor, source, webhook_event_id, resolved_by, resolved_at
       FROM jm_human_task_resolutions WHERE run_id = $1 AND node_id = $2
       ORDER BY resolved_at DESC LIMIT 1`,
      [runId, nodeId],
    );
    return r.rows[0] ? rowToObj(r.rows[0]) : null;
  }
}

function rowToObj(r: {
  id: string;
  run_id: string;
  node_id: string;
  outcome: string;
  comment: string | null;
  actor: string | null;
  source: "webhook" | "manual" | "timeout";
  webhook_event_id: string | null;
  resolved_by: string | null;
  resolved_at: Date | string;
}): HumanTaskResolutionRow {
  return {
    id: r.id,
    runId: r.run_id,
    nodeId: r.node_id,
    outcome: r.outcome,
    comment: r.comment,
    actor: r.actor,
    source: r.source,
    webhookEventId: r.webhook_event_id,
    resolvedBy: r.resolved_by,
    resolvedAt: r.resolved_at instanceof Date ? r.resolved_at : new Date(r.resolved_at),
  };
}
