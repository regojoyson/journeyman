import type { WorkflowGraph } from "./flow.types.ts";
import type { WorkflowInstanceGrantRole } from "./workflow-instance-grants.types.ts";

export type WorkflowInstanceStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type TriggerSource = "manual" | "webhook" | "schedule" | "api";

export interface WorkflowInstance {
  id: string;
  workflowId: string | null;
  workflowVersionId: string | null;
  workflowNameSnapshot: string;
  workflowScopeSnapshot: "user" | "org" | "global";
  definitionSnapshot: WorkflowGraph;
  status: WorkflowInstanceStatus;
  triggerSource: TriggerSource;
  startedByUserId: string | null;
  engineWorkflowId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  failedAtNodeId: string | null;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown> | null;
  /** Workflow-wide retry attempt number (1 on first run; incremented when workflowRetry fires). */
  attemptNumber: number;
  webhookEventId: string | null;
  /** Hydrated by the API layer for the calling actor. */
  effectiveRole?: WorkflowInstanceGrantRole;
}

export type WorkflowInstanceEventType =
  | "step.started"
  | "step.log"
  | "step.failed"
  | "step.retrying"
  | "step.completed"
  | "step.skipped"
  | "node.cycled"
  | "node.waiting"
  | "node.resolved"
  | "edge.taken"
  | "condition.evaluated"
  | "worker.heartbeat"
  | "task.polled"
  | "task.dispatched"
  | "workflow_instance.started"
  | "workflow_instance.completed"
  | "workflow_instance.failed"
  | "workflow_instance.cancelled";

export interface WorkflowInstanceEvent {
  id: number;
  workflowInstanceId: string;
  nodeId: string | null;
  eventType: WorkflowInstanceEventType;
  payload: Record<string, unknown>;
  ts: Date;
}

export type NodeExecutionStatus =
  | "pending"
  | "running"
  | "retrying"
  | "waiting"
  | "completed"
  | "failed"
  | "skipped";

export interface NodeExecution {
  id: string;
  workflowInstanceId: string;
  nodeId: string;
  attempt: number;
  status: NodeExecutionStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorClass: string | null;
  errorMessage: string | null;
  /** Conductor task id captured by the engine reconciler when a HUMAN task enters IN_PROGRESS. */
  conductorTaskId?: string | null;
}
