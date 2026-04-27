import type { Pool } from "pg";
import type {
  CreateRunArgs, INodeExecutionStore, IRunStore, NodeExecution, Run, RunStatus,
} from "@journeyman/core";

function rowToRun(row: any): Run {
  return {
    id: row.id,
    flowVersionId: row.flow_version_id,
    status: row.status,
    triggerSource: row.trigger_source,
    startedByUserId: row.started_by_user_id,
    engineWorkflowId: row.engine_workflow_id,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    durationMs: row.duration_ms,
    failedAtNodeId: row.failed_at_node_id,
    inputs: row.inputs ?? {},
    outputs: row.outputs,
  };
}

export class PostgresRunStore implements IRunStore {
  constructor(private pool: Pool) {}

  async create(args: CreateRunArgs): Promise<Run> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_runs (flow_version_id, status, trigger_source, started_by_user_id, inputs)
       VALUES ($1, 'pending', $2, $3, $4::jsonb) RETURNING *`,
      [args.flowVersionId, args.triggerSource, args.startedByUserId, JSON.stringify(args.inputs)],
    );
    return rowToRun(rows[0]);
  }

  async getById(runId: string): Promise<Run | null> {
    const { rows } = await this.pool.query("SELECT * FROM jm_runs WHERE id = $1", [runId]);
    return rows[0] ? rowToRun(rows[0]) : null;
  }

  async setEngineWorkflowId(runId: string, engineWorkflowId: string): Promise<void> {
    await this.pool.query(
      "UPDATE jm_runs SET engine_workflow_id = $1 WHERE id = $2", [engineWorkflowId, runId],
    );
  }

  async setStatus(runId: string, status: RunStatus, opts: {
    failedAtNodeId?: string;
    completedAt?: Date;
    durationMs?: number;
    outputs?: Record<string, unknown>;
  } = {}): Promise<void> {
    await this.pool.query(
      `UPDATE jm_runs SET
         status = $1,
         failed_at_node_id = COALESCE($2, failed_at_node_id),
         completed_at = COALESCE($3, completed_at),
         duration_ms = COALESCE($4, duration_ms),
         outputs = COALESCE($5::jsonb, outputs),
         started_at = COALESCE(started_at, CASE WHEN $1 = 'running' THEN now() ELSE NULL END)
       WHERE id = $6`,
      [
        status,
        opts.failedAtNodeId ?? null,
        opts.completedAt ?? null,
        opts.durationMs ?? null,
        opts.outputs ? JSON.stringify(opts.outputs) : null,
        runId,
      ],
    );
  }

  async list(opts: { flowId?: string; status?: RunStatus; limit?: number } = {}): Promise<Run[]> {
    const conds: string[] = [];
    const params: any[] = [];
    if (opts.status) { params.push(opts.status); conds.push(`status = $${params.length}`); }
    if (opts.flowId) {
      params.push(opts.flowId);
      conds.push(`flow_version_id IN (SELECT id FROM jm_flow_versions WHERE flow_id = $${params.length})`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const limit = opts.limit ? `LIMIT ${Number(opts.limit)}` : "LIMIT 100";
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_runs ${where} ORDER BY created_at DESC ${limit}`, params,
    );
    return rows.map(rowToRun);
  }
}

function rowToExec(row: any): NodeExecution {
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    attempt: row.attempt,
    status: row.status,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    input: row.input ?? {},
    output: row.output,
    errorClass: row.error_class,
    errorMessage: row.error_message,
  };
}

export class PostgresNodeExecutionStore implements INodeExecutionStore {
  constructor(private pool: Pool) {}

  async upsert(e: NodeExecution): Promise<void> {
    await this.pool.query(
      `INSERT INTO jm_node_executions
         (id, run_id, node_id, attempt, status, started_at, completed_at,
          input, output, error_class, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
       ON CONFLICT (run_id, node_id, attempt) DO UPDATE SET
         status = EXCLUDED.status,
         started_at = EXCLUDED.started_at,
         completed_at = EXCLUDED.completed_at,
         output = EXCLUDED.output,
         error_class = EXCLUDED.error_class,
         error_message = EXCLUDED.error_message`,
      [
        e.id, e.runId, e.nodeId, e.attempt, e.status,
        e.startedAt, e.completedAt,
        JSON.stringify(e.input),
        e.output ? JSON.stringify(e.output) : null,
        e.errorClass, e.errorMessage,
      ],
    );
  }

  async listByRun(runId: string): Promise<NodeExecution[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_node_executions WHERE run_id = $1 ORDER BY started_at NULLS LAST",
      [runId],
    );
    return rows.map(rowToExec);
  }
}
