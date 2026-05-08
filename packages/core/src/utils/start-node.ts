import type { WorkflowInputDef, WorkflowNode } from "../types/flow.types.ts";

/**
 * Read the start node's declared workflow inputs.
 *
 * Reads `workflowInputs` (current key), falling back to `runInputs` (legacy
 * key from before the flow/run → workflow rename) so workflows persisted
 * under the old key keep validating until they're next saved.
 */
export function getStartWorkflowInputs(startConfig: WorkflowNode["config"] | undefined): WorkflowInputDef[] {
  const cfg = (startConfig ?? {}) as { workflowInputs?: WorkflowInputDef[]; runInputs?: WorkflowInputDef[] };
  return cfg.workflowInputs ?? cfg.runInputs ?? [];
}
