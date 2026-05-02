export type RunStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type TriggerSource = "manual" | "webhook" | "schedule" | "api";

export interface Run {
  id: string;
  flowId: string | null;            // advisory; nullable if source flow deleted
  flowVersionId: string | null;     // advisory; nullable if source version deleted
  flowNameSnapshot: string;
  flowScopeSnapshot: "user" | "org" | "global";
  definitionSnapshot: import("./flow.types.ts").FlowGraph;
  status: RunStatus;
  triggerSource: TriggerSource;
  startedByUserId: string | null;
  engineWorkflowId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  failedAtNodeId: string | null;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown> | null;
  /** Flow-wide retry attempt number (1 on first run; incremented when flowRetry fires). */
  attemptNumber: number;
  webhookEventId: string | null;
  /** Hydrated by the API layer for the calling actor. */
  effectiveRole?: import("./run-grants.types.ts").RunGrantRole;
}

export type RunEventType =
  | "phase.started"
  | "phase.log"
  | "phase.failed"
  | "phase.retrying"
  | "phase.completed"
  | "node.cycled"
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "run.cancelled";

export interface RunEvent {
  id: number;             // monotonically increasing — used for SSE replay-since
  runId: string;
  nodeId: string | null;
  eventType: RunEventType;
  payload: Record<string, unknown>;
  ts: Date;
}

export type NodeExecutionStatus =
  | "pending"
  | "running"
  | "retrying"
  | "completed"
  | "failed"
  | "skipped";

export interface NodeExecution {
  id: string;
  runId: string;
  nodeId: string;
  attempt: number;
  status: NodeExecutionStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorClass: string | null;
  errorMessage: string | null;
}
