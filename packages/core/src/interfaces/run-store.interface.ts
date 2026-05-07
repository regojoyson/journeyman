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
  webhookEventId?: string | null;
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
    provider?: string;
    issueRef?: string;
  }): Promise<Run[]>;
  /** Paused runs (status='paused') whose `inputs.issueRef` equals the given value. */
  findPausedRunsByIssueRef(issueRef: string): Promise<Run[]>;
  /** Active (not-yet-finished) runs whose `inputs.issueRef` equals the given value. */
  findActiveRunsByIssueRef(issueRef: string): Promise<Run[]>;
}

export interface INodeExecutionStore {
  upsert(execution: NodeExecution): Promise<void>;
  listByRun(runId: string): Promise<NodeExecution[]>;
  /** Mark (or insert) a `waiting` execution row and store the Conductor task id. */
  markWaiting(runId: string, nodeId: string, conductorTaskId: string): Promise<NodeExecution>;
  /** Mark a specific execution row as `completed` with output. */
  markCompleted(executionId: string, output: Record<string, unknown>): Promise<NodeExecution>;
  /** Most recent execution row for the (run, node) pair, regardless of attempt. */
  latestForNode(runId: string, nodeId: string): Promise<NodeExecution | null>;
  /** Most recent execution row for the run whose status is `waiting`. */
  latestWaitingForRun(runId: string): Promise<NodeExecution | null>;
}
