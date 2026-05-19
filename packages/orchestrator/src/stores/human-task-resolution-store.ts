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
         (run_id, node_id, outcome, comment, actor, source, webhook_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, run_id, node_id, outcome, comment, actor, source, webhook_event_id, resolved_at`,
      [input.runId, input.nodeId, input.outcome, input.comment, input.actor, input.source, input.webhookEventId],
    );
    return rowToObj(r.rows[0]);
  }

  async listForRun(runId: string): Promise<HumanTaskResolutionRow[]> {
    const r = await this.pool.query(
      `SELECT id, run_id, node_id, outcome, comment, actor, source, webhook_event_id, resolved_at
       FROM jm_human_task_resolutions WHERE run_id = $1 ORDER BY resolved_at ASC`,
      [runId],
    );
    return r.rows.map(rowToObj);
  }

  async latestForNode(runId: string, nodeId: string): Promise<HumanTaskResolutionRow | null> {
    const r = await this.pool.query(
      `SELECT id, run_id, node_id, outcome, comment, actor, source, webhook_event_id, resolved_at
       FROM jm_human_task_resolutions WHERE run_id = $1 AND node_id = $2
       ORDER BY resolved_at DESC LIMIT 1`,
      [runId, nodeId],
    );
    return r.rows[0] ? rowToObj(r.rows[0]) : null;
  }
}

export class MemoryHumanTaskResolutionStore implements IHumanTaskResolutionStore {
  private rows: HumanTaskResolutionRow[] = [];
  private nextId = 1;
  async create(input: Omit<HumanTaskResolutionRow, "id" | "resolvedAt">): Promise<HumanTaskResolutionRow> {
    const row: HumanTaskResolutionRow = { id: String(this.nextId++), resolvedAt: new Date(), ...input };
    this.rows.push(row);
    return row;
  }
  async listForRun(runId: string): Promise<HumanTaskResolutionRow[]> {
    return this.rows.filter(r => r.runId === runId).slice().sort((a, b) => +a.resolvedAt - +b.resolvedAt);
  }
  async latestForNode(runId: string, nodeId: string): Promise<HumanTaskResolutionRow | null> {
    const list = this.rows.filter(r => r.runId === runId && r.nodeId === nodeId)
      .sort((a, b) => +b.resolvedAt - +a.resolvedAt);
    return list[0] ?? null;
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
    resolvedAt: r.resolved_at instanceof Date ? r.resolved_at : new Date(r.resolved_at),
  };
}
