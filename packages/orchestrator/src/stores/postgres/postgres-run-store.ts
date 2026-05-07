import type { Pool } from "pg";
import type {
  ActorContext, CreateRunArgs, INodeExecutionStore, IRunStore, NodeExecution, Run, RunListScope, RunStatus,
} from "@journeyman/core";

function rowToRun(row: any): Run {
  return {
    id: row.id,
    flowId: row.flow_id,
    flowVersionId: row.flow_version_id,
    flowNameSnapshot: row.flow_name_snapshot,
    flowScopeSnapshot: row.flow_scope_snapshot,
    definitionSnapshot: row.definition_snapshot,
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
    attemptNumber: row.attempt_number ?? 1,
    webhookEventId: row.webhook_event_id ?? null,
  };
}

function grantMatchSql(
  actor: ActorContext,
  scope: RunListScope | undefined,
  params: any[],
  nextIdx: () => number,
): string {
  const clauses: string[] = [];

  if (scope === "mine") {
    if (actor.userId) {
      clauses.push(`(g.principal_type = 'user' AND g.principal_id = $${nextIdx()} AND g.role = 'owner')`);
      params.push(actor.userId);
    }
    if (actor.role === "admin" && actor.orgId) {
      clauses.push(`(g.principal_type = 'org' AND g.principal_id = $${nextIdx()})`);
      params.push(actor.orgId);
    }
  } else if (scope === "org") {
    if (actor.orgId) {
      clauses.push(`(g.principal_type = 'org' AND g.principal_id = $${nextIdx()})`);
      params.push(actor.orgId);
    }
  } else {
    // default scope (no filter): everything actor can see
    if (actor.userId) {
      clauses.push(`(g.principal_type = 'user' AND g.principal_id = $${nextIdx()})`);
      params.push(actor.userId);
    }
    if (actor.orgId) {
      clauses.push(`(g.principal_type = 'org' AND g.principal_id = $${nextIdx()})`);
      params.push(actor.orgId);
    }
    clauses.push(`(g.principal_type = 'global')`);
  }

  return clauses.length ? `(${clauses.join(" OR ")})` : "FALSE";
}

export class PostgresRunStore implements IRunStore {
  constructor(private pool: Pool) {}

  async create(args: CreateRunArgs): Promise<Run> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_runs
         (flow_id, flow_version_id, flow_name_snapshot, flow_scope_snapshot, definition_snapshot,
          status, trigger_source, started_by_user_id, inputs, webhook_event_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', $6, $7, $8::jsonb, $9)
       RETURNING *`,
      [
        args.flowId, args.flowVersionId,
        args.flowNameSnapshot, args.flowScopeSnapshot,
        JSON.stringify(args.definitionSnapshot),
        args.triggerSource, args.startedByUserId,
        JSON.stringify(args.inputs),
        args.webhookEventId ?? null,
      ],
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

  async setAttemptNumber(runId: string, attemptNumber: number): Promise<void> {
    await this.pool.query(
      "UPDATE jm_runs SET attempt_number = $1 WHERE id = $2", [attemptNumber, runId],
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

  async list(opts: {
    flowId?: string;
    status?: import("@journeyman/core").RunStatus;
    limit?: number;
    actor?: ActorContext;
    scope?: RunListScope;
    provider?: string;
    issueRef?: string;
  } = {}): Promise<import("@journeyman/core").Run[]> {
    const conds: string[] = [];
    const params: any[] = [];
    let i = 1;
    const nextIdx = () => i++;

    if (opts.flowId)   { conds.push(`r.flow_id = $${nextIdx()}`);    params.push(opts.flowId); }
    if (opts.status)   { conds.push(`r.status = $${nextIdx()}`);     params.push(opts.status); }
    if (opts.provider) { conds.push(`w.provider = $${nextIdx()}`);   params.push(opts.provider); }
    if (opts.issueRef) { conds.push(`w.issue_ref = $${nextIdx()}`);  params.push(opts.issueRef); }

    const webhookJoin = (opts.provider || opts.issueRef)
      ? "LEFT JOIN jm_webhook_events w ON r.webhook_event_id = w.id"
      : "";

    let joinClause = "";
    if (opts.actor && !(opts.actor.isPlatformAdmin && opts.scope === "all")) {
      joinClause = `
      JOIN LATERAL (
        SELECT 1 FROM jm_run_grants g
        WHERE g.run_id = r.id
          AND ${grantMatchSql(opts.actor, opts.scope, params, nextIdx)}
        LIMIT 1
      ) gm ON TRUE
    `;
    }

    const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const limitSql = opts.limit ? `LIMIT $${nextIdx()}` : "";
    if (opts.limit) params.push(opts.limit);

    const sql = `
    SELECT DISTINCT r.* FROM jm_runs r
    ${webhookJoin}
    ${joinClause}
    ${whereSql}
    ORDER BY r.started_at DESC NULLS LAST
    ${limitSql}
  `;
    const { rows } = await this.pool.query(sql, params);
    return rows.map(rowToRun);
  }

  async findPausedRunsByIssueRef(issueRef: string): Promise<import("@journeyman/core").Run[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_runs
       WHERE status = 'paused' AND (inputs->>'issueRef') = $1
       ORDER BY started_at DESC NULLS LAST`,
      [issueRef],
    );
    return rows.map(rowToRun);
  }

  async findActiveRunsByIssueRef(issueRef: string): Promise<import("@journeyman/core").Run[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_runs
       WHERE status IN ('pending','running','paused') AND (inputs->>'issueRef') = $1
       ORDER BY started_at DESC NULLS LAST`,
      [issueRef],
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
    conductorTaskId: row.conductor_task_id ?? null,
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

  async markWaiting(runId: string, nodeId: string, conductorTaskId: string): Promise<NodeExecution> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_node_executions
         (run_id, node_id, attempt, status, started_at, input, conductor_task_id)
       VALUES ($1, $2, 1, 'waiting', now(), '{}'::jsonb, $3)
       ON CONFLICT (run_id, node_id, attempt) DO UPDATE SET
         status = 'waiting',
         conductor_task_id = EXCLUDED.conductor_task_id
       RETURNING *`,
      [runId, nodeId, conductorTaskId],
    );
    return rowToExec(rows[0]);
  }

  async markCompleted(executionId: string, output: Record<string, unknown>): Promise<NodeExecution> {
    const { rows } = await this.pool.query(
      `UPDATE jm_node_executions
       SET status = 'completed', completed_at = now(), output = $2::jsonb
       WHERE id = $1 RETURNING *`,
      [executionId, JSON.stringify(output)],
    );
    if (rows.length === 0) throw new Error(`node_execution ${executionId} not found`);
    return rowToExec(rows[0]);
  }

  async latestForNode(runId: string, nodeId: string): Promise<NodeExecution | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_node_executions
       WHERE run_id = $1 AND node_id = $2
       ORDER BY started_at DESC NULLS LAST LIMIT 1`,
      [runId, nodeId],
    );
    return rows[0] ? rowToExec(rows[0]) : null;
  }

  async latestWaitingForRun(runId: string): Promise<NodeExecution | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_node_executions
       WHERE run_id = $1 AND status = 'waiting'
       ORDER BY started_at DESC NULLS LAST LIMIT 1`,
      [runId],
    );
    return rows[0] ? rowToExec(rows[0]) : null;
  }
}
