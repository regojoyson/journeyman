import type { MinimalEventBus } from "@journeyman/core";

interface ConductorTask {
  taskType: string;
  status: string;
  referenceTaskName: string;
  inputData?: Record<string, unknown>;
  outputData?: Record<string, unknown>;
}

export async function emitRoutingEvents(
  events: MinimalEventBus,
  workflowInstanceId: string,
  tasks: ConductorTask[],
): Promise<void> {
  for (const t of tasks) {
    if (t.status === "SKIPPED") {
      await events.append({
        workflowInstanceId, nodeId: t.referenceTaskName,
        eventType: "phase.skipped",
        payload: { reason: "engine_skipped", taskType: t.taskType },
      });
      continue;
    }
    if (t.taskType === "SWITCH" && t.status === "COMPLETED") {
      const out = t.outputData ?? {};
      const inp = t.inputData ?? {};
      const result =
        (out.selectedCase as string | undefined) ??
        (Array.isArray(out.evaluationResult) ? (out.evaluationResult[0] as string | undefined) : undefined);
      await events.append({
        workflowInstanceId, nodeId: t.referenceTaskName,
        eventType: "condition.evaluated",
        payload: { expression: inp.expression, inputs: inp, result },
      });
      if (result) {
        await events.append({
          workflowInstanceId, nodeId: t.referenceTaskName,
          eventType: "edge.taken",
          payload: { target: result },
        });
      }
    }
  }
}
