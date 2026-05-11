import type { WorkflowInputDef, WorkflowNode } from "../types/flow.types.ts";

export function getStartWorkflowInputs(startConfig: WorkflowNode["config"] | undefined): WorkflowInputDef[] {
  const cfg = (startConfig ?? {}) as { workflowInputs?: WorkflowInputDef[] };
  return cfg.workflowInputs ?? [];
}
