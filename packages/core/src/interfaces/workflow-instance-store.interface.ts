import type { WorkflowGraph } from "../types/flow.types.ts";
import type {
  WorkflowInstance, NodeExecution, WorkflowInstanceStatus, TriggerSource,
} from "../types/workflow-instance.types.ts";
import type { ActorContext, WorkflowInstanceListScope } from "../types/workflow-instance-grants.types.ts";

export interface CreateWorkflowInstanceArgs {
  workflowId: string | null;
  workflowVersionId: string | null;
  workflowNameSnapshot: string;
  workflowScopeSnapshot: "user" | "org" | "global";
  definitionSnapshot: WorkflowGraph;
  triggerSource: TriggerSource;
  startedByUserId: string | null;
  startedByOrgId: string | null;
  inputs: Record<string, unknown>;
  webhookEventId?: string | null;
  /** Id of the trigger node that started this instance. */
  triggerNodeId?: string | null;
  /** When started via trigger-human, the originating form submission id. */
  formSubmissionId?: string | null;
  /** Optional issueRef for cross-instance correlation. */
  issueRef?: string | null;
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
    workflowId?: string;
    status?: WorkflowInstanceStatus;
    limit?: number;
    offset?: number;
    actor?: ActorContext;
    scope?: WorkflowInstanceListScope;
    provider?: string;
    issueRef?: string;
  }): Promise<WorkflowInstance[]>;
  count(opts?: {
    workflowId?: string;
    status?: WorkflowInstanceStatus;
    actor?: ActorContext;
    scope?: WorkflowInstanceListScope;
    provider?: string;
    issueRef?: string;
  }): Promise<number>;
  findPausedInstancesByIssueRef(issueRef: string): Promise<WorkflowInstance[]>;
  findActiveInstancesByIssueRef(issueRef: string): Promise<WorkflowInstance[]>;
}

export interface INodeExecutionStore {
  upsert(execution: NodeExecution): Promise<void>;
  listByWorkflowInstance(workflowInstanceId: string): Promise<NodeExecution[]>;
  markWaiting(workflowInstanceId: string, nodeId: string, conductorTaskId: string): Promise<NodeExecution>;
  markCompleted(executionId: string, output: Record<string, unknown>): Promise<NodeExecution>;
  latestForNode(workflowInstanceId: string, nodeId: string): Promise<NodeExecution | null>;
  latestWaitingForInstance(workflowInstanceId: string): Promise<NodeExecution | null>;
  /**
   * Find paused-instance node executions in `waiting` status older than
   * `maxAgeMs`. Used by the webhook-wait max-age sweeper. Returns up to
   * `limit` rows ordered by started_at ASC. Callers must still verify
   * `node.type === "webhook-wait"` against the instance's definition snapshot
   * since this row does not carry the node type.
   */
  listOverAgePausedNodeExecutions(maxAgeMs: number, limit: number): Promise<NodeExecution[]>;
}
