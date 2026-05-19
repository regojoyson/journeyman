import type { WorkflowInstanceEvent, WorkflowInstanceEventType } from "../types/workflow-instance.types.ts";

export interface AppendEventArgs {
  workflowInstanceId: string;
  nodeId?: string | null;
  eventType: WorkflowInstanceEventType;
  payload: Record<string, unknown>;
}

export interface IEventBus {
  append(args: AppendEventArgs): Promise<WorkflowInstanceEvent>;
  list(workflowInstanceId: string, opts?: { sinceId?: number; limit?: number }): Promise<WorkflowInstanceEvent[]>;
  /** Async iterator that yields events as they're appended (Phase 3 SSE). */
  subscribe(workflowInstanceId: string, opts?: { sinceId?: number }): AsyncIterable<WorkflowInstanceEvent>;
}
