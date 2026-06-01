import { randomUUID } from "node:crypto";
import type {
  CreateWorkflowInstanceArgs, INodeExecutionStore, IWorkflowInstanceStore,
  NodeExecution, WorkflowInstance, WorkflowInstanceStatus,
  ActorContext, WorkflowInstanceListScope,
} from "@journeyman/core";
import { isTerminalStatus } from "@journeyman/core";

export class MemoryWorkflowInstanceStore implements IWorkflowInstanceStore {
  private rows = new Map<string, WorkflowInstance>();

  async create(args: CreateWorkflowInstanceArgs): Promise<WorkflowInstance> {
    const instance: WorkflowInstance = {
      id: randomUUID(),
      workflowId: args.workflowId,
      workflowVersionId: args.workflowVersionId,
      workflowNameSnapshot: args.workflowNameSnapshot,
      workflowScopeSnapshot: args.workflowScopeSnapshot,
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
      triggerNodeId: args.triggerNodeId ?? null,
      formSubmissionId: args.formSubmissionId ?? null,
    };
    this.rows.set(instance.id, instance);
    return instance;
  }

  async getById(workflowInstanceId: string): Promise<WorkflowInstance | null> {
    return this.rows.get(workflowInstanceId) ?? null;
  }

  async setEngineWorkflowId(workflowInstanceId: string, engineWorkflowId: string): Promise<void> {
    const r = this.rows.get(workflowInstanceId);
    if (!r) return;
    this.rows.set(workflowInstanceId, { ...r, engineWorkflowId });
  }

  async setAttemptNumber(workflowInstanceId: string, attemptNumber: number): Promise<void> {
    const r = this.rows.get(workflowInstanceId);
    if (!r) return;
    this.rows.set(workflowInstanceId, { ...r, attemptNumber });
  }

  async setStatus(workflowInstanceId: string, status: WorkflowInstanceStatus, opts: {
    failedAtNodeId?: string;
    completedAt?: Date;
    durationMs?: number;
    outputs?: Record<string, unknown>;
  } = {}): Promise<void> {
    const r = this.rows.get(workflowInstanceId);
    if (!r) return;
    this.rows.set(workflowInstanceId, {
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
    workflowId?: string;
    status?: WorkflowInstanceStatus;
    limit?: number;
    offset?: number;
    actor?: ActorContext;
    scope?: WorkflowInstanceListScope;
    provider?: string;
  } = {}): Promise<WorkflowInstance[]> {
    let out = this.filtered(opts);
    const offset = opts.offset ?? 0;
    if (offset) out = out.slice(offset);
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  }

  async count(opts: {
    workflowId?: string;
    status?: WorkflowInstanceStatus;
    actor?: ActorContext;
    scope?: WorkflowInstanceListScope;
    provider?: string;
  } = {}): Promise<number> {
    return this.filtered(opts).length;
  }

  private filtered(opts: {
    workflowId?: string;
    status?: WorkflowInstanceStatus;
  }): WorkflowInstance[] {
    let out = [...this.rows.values()];
    if (opts.workflowId) out = out.filter(r => r.workflowId === opts.workflowId);
    if (opts.status) out = out.filter(r => r.status === opts.status);
    return out;
  }

  /** Internal helper used by MemoryNodeExecutionStore to filter by instance status. */
  allInstances(): IterableIterator<WorkflowInstance> {
    return this.rows.values();
  }
}

export class MemoryNodeExecutionStore implements INodeExecutionStore {
  private rows = new Map<string, NodeExecution>();
  private nextId = 1;

  constructor(private readonly instances?: MemoryWorkflowInstanceStore) {}

  async upsert(execution: NodeExecution): Promise<void> {
    this.rows.set(execution.id, execution);
  }

  async listByWorkflowInstance(workflowInstanceId: string): Promise<NodeExecution[]> {
    return [...this.rows.values()].filter(x => x.workflowInstanceId === workflowInstanceId);
  }

  async markWaiting(
    workflowInstanceId: string,
    nodeId: string,
    conductorTaskId: string,
    correlation?: { eventPath: string; value: string } | null,
  ): Promise<NodeExecution> {
    const correlationEventPath = correlation?.eventPath ?? null;
    const correlationValue = correlation?.value ?? null;
    const existing = [...this.rows.values()].find(r =>
      r.workflowInstanceId === workflowInstanceId && r.nodeId === nodeId && r.attempt === 1,
    );
    if (existing) {
      const updated: NodeExecution = {
        ...existing,
        status: "waiting",
        conductorTaskId,
        correlationEventPath,
        correlationValue,
      };
      this.rows.set(updated.id, updated);
      return updated;
    }
    const row: NodeExecution = {
      id: `mem-${this.nextId++}`,
      workflowInstanceId, nodeId, attempt: 1, status: "waiting",
      startedAt: new Date(), completedAt: null,
      input: {}, output: null, errorClass: null, errorMessage: null,
      conductorTaskId,
      correlationEventPath,
      correlationValue,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async findAllWaitingWithCorrelation(): Promise<NodeExecution[]> {
    if (!this.instances) return [];
    const liveInstanceIds = new Set(
      [...this.instances.allInstances()].filter(i => !isTerminalStatus(i.status)).map(i => i.id),
    );
    return [...this.rows.values()].filter(e =>
      e.status === "waiting"
      && liveInstanceIds.has(e.workflowInstanceId)
      && e.correlationValue != null,
    );
  }

  async markCompleted(executionId: string, output: Record<string, unknown>): Promise<NodeExecution> {
    const row = this.rows.get(executionId);
    if (!row) throw new Error(`node_execution ${executionId} not found`);
    const updated: NodeExecution = { ...row, status: "completed", completedAt: new Date(), output };
    this.rows.set(executionId, updated);
    return updated;
  }

  async markSkipped(executionId: string): Promise<NodeExecution> {
    const row = this.rows.get(executionId);
    if (!row) throw new Error(`node_execution ${executionId} not found`);
    const updated: NodeExecution = { ...row, status: "skipped", completedAt: new Date() };
    this.rows.set(executionId, updated);
    return updated;
  }

  async latestForNode(workflowInstanceId: string, nodeId: string): Promise<NodeExecution | null> {
    const list = [...this.rows.values()]
      .filter(r => r.workflowInstanceId === workflowInstanceId && r.nodeId === nodeId)
      .sort((a, b) => +(b.startedAt ?? 0) - +(a.startedAt ?? 0));
    return list[0] ?? null;
  }

  async latestWaitingForInstance(workflowInstanceId: string): Promise<NodeExecution | null> {
    const list = [...this.rows.values()]
      .filter(r => r.workflowInstanceId === workflowInstanceId && r.status === "waiting")
      .sort((a, b) => +(b.startedAt ?? 0) - +(a.startedAt ?? 0));
    return list[0] ?? null;
  }

  async listOverAgePausedNodeExecutions(maxAgeMs: number, limit: number): Promise<NodeExecution[]> {
    if (!this.instances) return [];
    const cutoff = Date.now() - maxAgeMs;
    const liveInstanceIds = new Set(
      [...this.instances.allInstances()].filter(i => !isTerminalStatus(i.status)).map(i => i.id),
    );
    return [...this.rows.values()]
      .filter(e =>
        e.status === "waiting" &&
        liveInstanceIds.has(e.workflowInstanceId) &&
        e.startedAt != null &&
        e.startedAt.getTime() < cutoff,
      )
      .sort((a, b) => +(a.startedAt ?? 0) - +(b.startedAt ?? 0))
      .slice(0, limit);
  }
}
