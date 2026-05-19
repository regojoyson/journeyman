import type { Pool } from "pg";
import type { AppendEventArgs, IEventBus, WorkflowInstanceEvent } from "@journeyman/core";

function rowToEvent(row: any): WorkflowInstanceEvent {
  return {
    id: Number(row.id),
    workflowInstanceId: row.workflow_instance_id,
    nodeId: row.node_id,
    eventType: row.event_type,
    payload: row.payload ?? {},
    ts: new Date(row.ts),
  };
}

export class PostgresEventBus implements IEventBus {
  constructor(private pool: Pool, private pollIntervalMs: number = 500) {}

  async append(args: AppendEventArgs): Promise<WorkflowInstanceEvent> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_workflow_instance_events (workflow_instance_id, node_id, event_type, payload)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
      [args.workflowInstanceId, args.nodeId ?? null, args.eventType, JSON.stringify(args.payload)],
    );
    return rowToEvent(rows[0]);
  }

  async list(workflowInstanceId: string, opts: { sinceId?: number; limit?: number } = {}): Promise<WorkflowInstanceEvent[]> {
    const params: any[] = [workflowInstanceId];
    let cond = "";
    if (opts.sinceId !== undefined) { params.push(opts.sinceId); cond = `AND id > $${params.length}`; }
    const limit = opts.limit ? `LIMIT ${Number(opts.limit)}` : "";
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_workflow_instance_events WHERE workflow_instance_id = $1 ${cond} ORDER BY id ${limit}`, params,
    );
    return rows.map(rowToEvent);
  }

  async *subscribe(workflowInstanceId: string, opts: { sinceId?: number } = {}): AsyncIterable<WorkflowInstanceEvent> {
    let last = opts.sinceId ?? 0;
    while (true) {
      const batch = await this.list(workflowInstanceId, { sinceId: last });
      for (const ev of batch) { yield ev; last = ev.id; }
      await new Promise(r => setTimeout(r, this.pollIntervalMs));
    }
  }
}
