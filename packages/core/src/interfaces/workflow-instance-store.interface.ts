import type { WorkflowGraph } from "../types/flow.types.ts";
import type {
  WorkflowInstance, NodeExecution, WorkflowInstanceStatus, TriggerSource,
} from "../types/workflow-instance.types.ts";
export interface CreateWorkflowInstanceArgs {
  workflowId: string | null;
  workflowVersionId: string | null;
  workflowNameSnapshot: string;
  workspaceId: string | null;
  definitionSnapshot: WorkflowGraph;
  triggerSource: TriggerSource;
  startedByUserId: string | null;
  inputs: Record<string, unknown>;
  webhookEventId?: string | null;
  /** Id of the trigger node that started this instance. */
  triggerNodeId?: string | null;
  /** When started via trigger-human, the originating form submission id. */
  formSubmissionId?: string | null;
}

export interface IWorkflowInstanceStore {
  create(args: CreateWorkflowInstanceArgs): Promise<WorkflowInstance>;
  getById(workflowInstanceId: string): Promise<WorkflowInstance | null>;
  setEngineWorkflowId(workflowInstanceId: string, engineWorkflowId: string): Promise<void>;
  setStatus(workflowInstanceId: string, status: WorkflowInstanceStatus, opts?: {
    failedAtNodeId?: string;
    completedAt?: Date;
    durationMs?: number;
    outputs?: Record<string, unknown>;
  }): Promise<void>;
  setAttemptNumber(workflowInstanceId: string, attemptNumber: number): Promise<void>;
  list(opts?: {
    workspaceId?: string;
    workflowId?: string;
    status?: WorkflowInstanceStatus;
    limit?: number;
    offset?: number;
    provider?: string;
  }): Promise<WorkflowInstance[]>;
  count(opts?: {
    workspaceId?: string;
    workflowId?: string;
    status?: WorkflowInstanceStatus;
    provider?: string;
  }): Promise<number>;
}

export interface INodeExecutionStore {
  upsert(execution: NodeExecution): Promise<void>;
  listByWorkflowInstance(workflowInstanceId: string): Promise<NodeExecution[]>;
  markWaiting(
    workflowInstanceId: string,
    nodeId: string,
    conductorTaskId: string,
    correlation?: { eventPath: string; value: string } | null,
  ): Promise<NodeExecution>;
  markCompleted(executionId: string, output: Record<string, unknown>): Promise<NodeExecution>;
  /** Flip a node execution to `skipped` (e.g. a cancelled first-wins loser). Clears it from waiting lookups. */
  markSkipped(executionId: string): Promise<NodeExecution>;
  latestForNode(workflowInstanceId: string, nodeId: string): Promise<NodeExecution | null>;
  latestWaitingForInstance(workflowInstanceId: string): Promise<NodeExecution | null>;
  /** Lookup paused-instance waits whose recorded correlation_value matches. Used by the matcher. */
  findAllWaitingWithCorrelation(): Promise<NodeExecution[]>;
  /**
   * Find paused-instance node executions in `waiting` status older than
   * `maxAgeMs`. Used by the webhook-wait max-age sweeper. Returns up to
   * `limit` rows ordered by started_at ASC. Callers must still verify
   * `node.type === "webhook-wait"` against the instance's definition snapshot
   * since this row does not carry the node type.
   */
  listOverAgePausedNodeExecutions(maxAgeMs: number, limit: number): Promise<NodeExecution[]>;
}
