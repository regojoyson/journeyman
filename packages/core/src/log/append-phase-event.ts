import type { WorkflowLogCtx } from "./workflow-logger.ts";
import type { WorkflowInstanceEventType } from "../types/workflow-instance.types.ts";

export interface MinimalEventBus {
  append(input: {
    workflowInstanceId: string;
    nodeId?: string | null;
    eventType: WorkflowInstanceEventType;
    payload: Record<string, unknown>;
  }): Promise<unknown>;
}

export async function appendPhaseEvent(
  events: MinimalEventBus,
  ctx: WorkflowLogCtx,
  eventType: WorkflowInstanceEventType,
  payload: Record<string, unknown>,
  onError?: (err: unknown) => void,
): Promise<void> {
  try {
    await events.append({
      workflowInstanceId: ctx.workflowInstanceId,
      nodeId: ctx.nodeId,
      eventType,
      payload: {
        ...payload,
        phaseType: ctx.phaseType,
        attempt: ctx.attempt,
        taskId: ctx.taskId,
        workerId: ctx.workerId,
      },
    });
  } catch (err) {
    onError?.(err);
  }
}
