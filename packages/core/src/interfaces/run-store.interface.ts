import type { FlowGraph } from "../types/flow.types.ts";
import type { Run, NodeExecution, RunStatus, TriggerSource } from "../types/run.types.ts";
import type { ActorContext, RunListScope } from "../types/run-grants.types.ts";

export interface CreateRunArgs {
  flowId: string | null;
  flowVersionId: string | null;
  flowNameSnapshot: string;
  flowScopeSnapshot: "user" | "org" | "global";
  definitionSnapshot: FlowGraph;
  triggerSource: TriggerSource;
  startedByUserId: string | null;
  startedByOrgId: string | null;
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
  setAttemptNumber(runId: string, attemptNumber: number): Promise<void>;
  list(opts?: {
    flowId?: string;
    status?: RunStatus;
    limit?: number;
    actor?: ActorContext;
    scope?: RunListScope;
  }): Promise<Run[]>;
}

export interface INodeExecutionStore {
  upsert(execution: NodeExecution): Promise<void>;
  listByRun(runId: string): Promise<NodeExecution[]>;
}
