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
  } = {}): Promise<Run[]> {
    let out = [...this.rows.values()];
    if (opts.flowId) out = out.filter(r => r.flowId === opts.flowId);
    if (opts.status) out = out.filter(r => r.status === opts.status);
    // Memory backend trusts the API layer to apply actor/scope filtering via
    // runGrants.matchForActor when needed; the postgres backend joins in SQL.
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  }
}

export class MemoryNodeExecutionStore implements INodeExecutionStore {
  private rows = new Map<string, NodeExecution>();

  async upsert(execution: NodeExecution): Promise<void> {
    this.rows.set(execution.id, execution);
  }

  async listByRun(runId: string): Promise<NodeExecution[]> {
    return [...this.rows.values()].filter(x => x.runId === runId);
  }
}
