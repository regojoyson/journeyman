import type { Run, NodeExecution, RunStatus, TriggerSource } from "../types/run.types.ts";

export interface CreateRunArgs {
  flowVersionId: string;
  triggerSource: TriggerSource;
  startedByUserId: string | null;
  inputs: Record<string, unknown>;
}

export interface IRunStore {
  create(args: CreateRunArgs): Promise<Run>;
  getById(runId: string): Promise<Run | null>;
  setEngineWorkflowId(runId: string, engineWorkflowId: string): Promise<void>;
  setStatus(runId: string, status: RunStatus, opts?: {
    failedAtNodeId?: string;
    completedAt?: Date;
    durationMs?: number;
    outputs?: Record<string, unknown>;
  }): Promise<void>;
  list(opts?: {
    flowId?: string;
    status?: RunStatus;
    limit?: number;
  }): Promise<Run[]>;
}

export interface INodeExecutionStore {
  upsert(execution: NodeExecution): Promise<void>;
  listByRun(runId: string): Promise<NodeExecution[]>;
}
