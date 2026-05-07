import { randomUUID } from "node:crypto";
import type {
  CreateRunArgs, INodeExecutionStore, IRunStore, NodeExecution, Run, RunStatus,
  ActorContext, RunListScope,
} from "@journeyman/core";

export class MemoryRunStore implements IRunStore {
  private rows = new Map<string, Run>();

  async create(args: CreateRunArgs): Promise<Run> {
    const run: Run = {
      id: randomUUID(),
      flowId: args.flowId,
      flowVersionId: args.flowVersionId,
      flowNameSnapshot: args.flowNameSnapshot,
      flowScopeSnapshot: args.flowScopeSnapshot,
      definitionSnapshot: args.definitionSnapshot,
      status: "pending",
      triggerSource: args.triggerSource,
      startedByUserId: args.startedByUserId,
      engineWorkflowId: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      failedAtNodeId: null,
      inputs: args.inputs,
      outputs: null,
      attemptNumber: 1,
      webhookEventId: args.webhookEventId ?? null,
    };
    this.rows.set(run.id, run);
    return run;
  }

  async getById(runId: string): Promise<Run | null> {
    return this.rows.get(runId) ?? null;
  }

  async setEngineWorkflowId(runId: string, engineWorkflowId: string): Promise<void> {
    const r = this.rows.get(runId);
    if (!r) return;
    this.rows.set(runId, { ...r, engineWorkflowId });
  }

  async setAttemptNumber(runId: string, attemptNumber: number): Promise<void> {
    const r = this.rows.get(runId);
    if (!r) return;
    this.rows.set(runId, { ...r, attemptNumber });
  }

  async setStatus(runId: string, status: RunStatus, opts: {
    failedAtNodeId?: string;
    completedAt?: Date;
    durationMs?: number;
    outputs?: Record<string, unknown>;
  } = {}): Promise<void> {
    const r = this.rows.get(runId);
    if (!r) return;
    this.rows.set(runId, {
      ...r,
      status,
      failedAtNodeId: opts.failedAtNodeId ?? r.failedAtNodeId,
      completedAt: opts.completedAt ?? r.completedAt,
      durationMs: opts.durationMs ?? r.durationMs,
      outputs: opts.outputs ?? r.outputs,
      startedAt: r.startedAt ?? (status === "running" ? new Date() : null),
    });
  }

  async list(opts: {
    flowId?: string;
    status?: RunStatus;
    limit?: number;
    actor?: ActorContext;
    scope?: RunListScope;
    provider?: string;
    issueRef?: string;
  } = {}): Promise<Run[]> {
    let out = [...this.rows.values()];
    if (opts.flowId) out = out.filter(r => r.flowId === opts.flowId);
    if (opts.status) out = out.filter(r => r.status === opts.status);
    // Memory backend trusts the API layer to apply actor/scope filtering via
    // runGrants.matchForActor when needed; the postgres backend joins in SQL.
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  }

  async findPausedRunsByIssueRef(issueRef: string): Promise<Run[]> {
    return [...this.rows.values()].filter(r =>
      r.status === "paused"
      && (r.inputs as { issueRef?: unknown })?.issueRef === issueRef,
    );
  }

  async findActiveRunsByIssueRef(issueRef: string): Promise<Run[]> {
    const active = new Set<RunStatus>(["pending", "running", "paused"]);
    return [...this.rows.values()].filter(r =>
      active.has(r.status)
      && (r.inputs as { issueRef?: unknown })?.issueRef === issueRef,
    );
  }
}

export class MemoryNodeExecutionStore implements INodeExecutionStore {
  private rows = new Map<string, NodeExecution>();
  private nextId = 1;

  async upsert(execution: NodeExecution): Promise<void> {
    this.rows.set(execution.id, execution);
  }

  async listByRun(runId: string): Promise<NodeExecution[]> {
    return [...this.rows.values()].filter(x => x.runId === runId);
  }

  async markWaiting(runId: string, nodeId: string, conductorTaskId: string): Promise<NodeExecution> {
    const existing = [...this.rows.values()].find(r =>
      r.runId === runId && r.nodeId === nodeId && r.attempt === 1,
    );
    if (existing) {
      const updated: NodeExecution = { ...existing, status: "waiting", conductorTaskId };
      this.rows.set(updated.id, updated);
      return updated;
    }
    const row: NodeExecution = {
      id: `mem-${this.nextId++}`,
      runId, nodeId, attempt: 1, status: "waiting",
      startedAt: new Date(), completedAt: null,
      input: {}, output: null, errorClass: null, errorMessage: null,
      conductorTaskId,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async markCompleted(executionId: string, output: Record<string, unknown>): Promise<NodeExecution> {
    const row = this.rows.get(executionId);
    if (!row) throw new Error(`node_execution ${executionId} not found`);
    const updated: NodeExecution = { ...row, status: "completed", completedAt: new Date(), output };
    this.rows.set(executionId, updated);
    return updated;
  }

  async latestForNode(runId: string, nodeId: string): Promise<NodeExecution | null> {
    const list = [...this.rows.values()]
      .filter(r => r.runId === runId && r.nodeId === nodeId)
      .sort((a, b) => +(b.startedAt ?? 0) - +(a.startedAt ?? 0));
    return list[0] ?? null;
  }

  async latestWaitingForRun(runId: string): Promise<NodeExecution | null> {
    const list = [...this.rows.values()]
      .filter(r => r.runId === runId && r.status === "waiting")
      .sort((a, b) => +(b.startedAt ?? 0) - +(a.startedAt ?? 0));
    return list[0] ?? null;
  }
}
