import type { Pool } from "pg";
import type {
  ActorContext, CreateWorkflowInstanceArgs, INodeExecutionStore, IWorkflowInstanceStore,
  NodeExecution, WorkflowInstance, WorkflowInstanceListScope, WorkflowInstanceStatus,
} from "@journeyman/core";

function rowToWorkflowInstance(row: any): WorkflowInstance {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowVersionId: row.workflow_version_id,
    workflowNameSnapshot: row.workflow_name_snapshot,
    workflowScopeSnapshot: row.workflow_scope_snapshot,
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
    triggerNodeId: row.trigger_node_id ?? null,
    formSubmissionId: row.form_submission_id ?? null,
  };
}

function grantMatchSql(
  actor: ActorContext,
  scope: WorkflowInstanceListScope | undefined,
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

export class PostgresWorkflowInstanceStore implements IWorkflowInstanceStore {
  constructor(private pool: Pool) {}

  async create(args: CreateWorkflowInstanceArgs): Promise<WorkflowInstance> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_workflow_instances
         (workflow_id, workflow_version_id, workflow_name_snapshot, workflow_scope_snapshot, definition_snapshot,
          status, trigger_source, started_by_user_id, inputs, webhook_event_id,
          trigger_node_id, form_submission_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', $6, $7, $8::jsonb, $9, $10, $11)
       RETURNING *`,
      [
        args.workflowId, args.workflowVersionId,
        args.workflowNameSnapshot, args.workflowScopeSnapshot,
        JSON.stringify(args.definitionSnapshot),
        args.triggerSource, args.startedByUserId,
        JSON.stringify(args.inputs),
        args.webhookEventId ?? null,
        args.triggerNodeId ?? null,
        args.formSubmissionId ?? null,
      ],
    );
    return rowToWorkflowInstance(rows[0]);
  }

  async getById(workflowInstanceId: string): Promise<WorkflowInstance | null> {
    const { rows } = await this.pool.query("SELECT * FROM jm_workflow_instances WHERE id = $1", [workflowInstanceId]);
    return rows[0] ? rowToWorkflowInstance(rows[0]) : null;
  }

  async setEngineWorkflowId(workflowInstanceId: string, engineWorkflowId: string): Promise<void> {
    await this.pool.query(
      "UPDATE jm_workflow_instances SET engine_workflow_id = $1 WHERE id = $2", [engineWorkflowId, workflowInstanceId],
    );
  }

  async setAttemptNumber(workflowInstanceId: string, attemptNumber: number): Promise<void> {
    await this.pool.query(
      "UPDATE jm_workflow_instances SET attempt_number = $1 WHERE id = $2", [attemptNumber, workflowInstanceId],
    );
  }

  async setStatus(workflowInstanceId: string, status: WorkflowInstanceStatus, opts: {
    failedAtNodeId?: string;
    completedAt?: Date;
    durationMs?: number;
    outputs?: Record<string, unknown>;
  } = {}): Promise<void> {
    await this.pool.query(
      `UPDATE jm_workflow_instances SET
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
        workflowInstanceId,
      ],
    );
  }

  async list(opts: {
    workflowId?: string;
    status?: WorkflowInstanceStatus;
    limit?: number;
    offset?: number;
    actor?: ActorContext;
    scope?: WorkflowInstanceListScope;
    provider?: string;
  } = {}): Promise<WorkflowInstance[]> {
    const { sql: baseSql, params } = this.buildListQuery(opts);
    const limitOffset: string[] = [];
    let idx = params.length;
    if (opts.limit) { params.push(opts.limit); limitOffset.push(`LIMIT $${++idx}`); }
    if (opts.offset) { params.push(opts.offset); limitOffset.push(`OFFSET $${++idx}`); }
    const sql = `${baseSql} ORDER BY r.started_at DESC NULLS LAST ${limitOffset.join(" ")}`;
    const { rows } = await this.pool.query(sql, params);
    return rows.map(rowToWorkflowInstance);
  }

  async count(opts: {
    workflowId?: string;
    status?: WorkflowInstanceStatus;
    actor?: ActorContext;
    scope?: WorkflowInstanceListScope;
    provider?: string;
  } = {}): Promise<number> {
    const { sql: baseSql, params } = this.buildListQuery(opts);
    const sql = `SELECT COUNT(*)::int AS n FROM (${baseSql}) sub`;
    const { rows } = await this.pool.query(sql, params);
    return rows[0]?.n ?? 0;
  }

  private buildListQuery(opts: {
    workflowId?: string;
    status?: WorkflowInstanceStatus;
    actor?: ActorContext;
    scope?: WorkflowInstanceListScope;
    provider?: string;
  }): { sql: string; params: any[] } {
    const conds: string[] = [];
    const params: any[] = [];
    let i = 1;
    const nextIdx = () => i++;

    if (opts.workflowId) { conds.push(`r.workflow_id = $${nextIdx()}`);   params.push(opts.workflowId); }
    if (opts.status)     { conds.push(`r.status = $${nextIdx()}`);         params.push(opts.status); }
    if (opts.provider)   { conds.push(`w.provider = $${nextIdx()}`);       params.push(opts.provider); }

    const webhookJoin = opts.provider
      ? "LEFT JOIN jm_webhook_events w ON r.webhook_event_id = w.id"
      : "";

    let joinClause = "";
    if (opts.actor && !(opts.actor.isPlatformAdmin && opts.scope === "all")) {
      joinClause = `
      JOIN LATERAL (
        SELECT 1 FROM jm_workflow_instance_grants g
        WHERE g.workflow_instance_id = r.id
          AND ${grantMatchSql(opts.actor, opts.scope, params, nextIdx)}
        LIMIT 1
      ) gm ON TRUE
    `;
    }

    const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const sql = `
    SELECT DISTINCT r.* FROM jm_workflow_instances r
    ${webhookJoin}
    ${joinClause}
    ${whereSql}
  `;
    return { sql, params };
  }

}

function rowToExec(row: any): NodeExecution {
  return {
    id: row.id,
    workflowInstanceId: row.workflow_instance_id,
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
    correlationEventPath: row.correlation_event_path ?? null,
    correlationValue: row.correlation_value ?? null,
  };
}

export class PostgresNodeExecutionStore implements INodeExecutionStore {
  constructor(private pool: Pool) {}

  async upsert(e: NodeExecution): Promise<void> {
    await this.pool.query(
      `INSERT INTO jm_node_executions
         (id, workflow_instance_id, node_id, attempt, status, started_at, completed_at,
          input, output, error_class, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
       ON CONFLICT (workflow_instance_id, node_id, attempt) DO UPDATE SET
         status = EXCLUDED.status,
         started_at = EXCLUDED.started_at,
         completed_at = EXCLUDED.completed_at,
         output = EXCLUDED.output,
         error_class = EXCLUDED.error_class,
         error_message = EXCLUDED.error_message`,
      [
        e.id, e.workflowInstanceId, e.nodeId, e.attempt, e.status,
        e.startedAt, e.completedAt,
        JSON.stringify(e.input),
        e.output ? JSON.stringify(e.output) : null,
        e.errorClass, e.errorMessage,
      ],
    );
  }

  async listByWorkflowInstance(workflowInstanceId: string): Promise<NodeExecution[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_node_executions WHERE workflow_instance_id = $1 ORDER BY started_at NULLS LAST",
      [workflowInstanceId],
    );
    return rows.map(rowToExec);
  }

  async markWaiting(
    workflowInstanceId: string,
    nodeId: string,
    conductorTaskId: string,
    correlation?: { eventPath: string; value: string } | null,
  ): Promise<NodeExecution> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_node_executions
         (workflow_instance_id, node_id, attempt, status, started_at, input,
          conductor_task_id, correlation_event_path, correlation_value)
       VALUES ($1, $2, 1, 'waiting', now(), '{}'::jsonb, $3, $4, $5)
       ON CONFLICT (workflow_instance_id, node_id, attempt) DO UPDATE SET
         status = 'waiting',
         conductor_task_id = EXCLUDED.conductor_task_id,
         correlation_event_path = EXCLUDED.correlation_event_path,
         correlation_value = EXCLUDED.correlation_value
       RETURNING *`,
      [
        workflowInstanceId, nodeId, conductorTaskId,
        correlation?.eventPath ?? null,
        correlation?.value ?? null,
      ],
    );
    return rowToExec(rows[0]);
  }

  async findAllWaitingWithCorrelation(): Promise<NodeExecution[]> {
    const { rows } = await this.pool.query(
      `SELECT ne.*
         FROM jm_node_executions ne
         JOIN jm_workflow_instances wi ON wi.id = ne.workflow_instance_id
        WHERE ne.status = 'waiting'
          AND wi.status NOT IN ('completed','failed','cancelled')
          AND ne.correlation_value IS NOT NULL`,
    );
    return rows.map(rowToExec);
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

  async markSkipped(executionId: string): Promise<NodeExecution> {
    const { rows } = await this.pool.query(
      `UPDATE jm_node_executions
       SET status = 'skipped', completed_at = now()
       WHERE id = $1 RETURNING *`,
      [executionId],
    );
    if (rows.length === 0) throw new Error(`node_execution ${executionId} not found`);
    return rowToExec(rows[0]);
  }

  async latestForNode(workflowInstanceId: string, nodeId: string): Promise<NodeExecution | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_node_executions
       WHERE workflow_instance_id = $1 AND node_id = $2
       ORDER BY started_at DESC NULLS LAST LIMIT 1`,
      [workflowInstanceId, nodeId],
    );
    return rows[0] ? rowToExec(rows[0]) : null;
  }

  async latestWaitingForInstance(workflowInstanceId: string): Promise<NodeExecution | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_node_executions
       WHERE workflow_instance_id = $1 AND status = 'waiting'
       ORDER BY started_at DESC NULLS LAST LIMIT 1`,
      [workflowInstanceId],
    );
    return rows[0] ? rowToExec(rows[0]) : null;
  }

  async listOverAgePausedNodeExecutions(maxAgeMs: number, limit: number): Promise<NodeExecution[]> {
    const { rows } = await this.pool.query(
      `SELECT ne.*
       FROM jm_node_executions ne
       JOIN jm_workflow_instances wi ON wi.id = ne.workflow_instance_id
       WHERE ne.status = 'waiting'
         AND wi.status NOT IN ('completed','failed','cancelled')
         AND ne.started_at IS NOT NULL
         AND ne.started_at < now() - make_interval(secs => $1::numeric / 1000)
       ORDER BY ne.started_at ASC
       LIMIT $2`,
      [maxAgeMs, limit],
    );
    return rows.map(rowToExec);
  }
}
