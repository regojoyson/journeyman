import type {
  IWorkflowVersionStore, IOrchestratorEngine, IWorkflowInstanceStore,
} from "@journeyman/core";

export interface RerunDeps {
  workflowInstances: IWorkflowInstanceStore;
  workflowVersions: IWorkflowVersionStore;
  orchestrator: IOrchestratorEngine;
}

export interface RerunResult {
  workflowInstanceId: string;
  engineWorkflowId: string | null;
}

/** Submit a fresh workflow instance with the same workflow version + same inputs as `originalWorkflowInstanceId`. */
export async function rerunFromExisting(
  deps: RerunDeps,
  originalWorkflowInstanceId: string,
  opts: { startedByUserId?: string | null; startedByOrgId?: string | null } = {},
): Promise<RerunResult> {
  const original = await deps.workflowInstances.getById(originalWorkflowInstanceId);
  if (!original) throw new Error(`WorkflowInstance not found: ${originalWorkflowInstanceId}`);

  // workflowVersionId is advisory/nullable — fall back to the definition snapshot baked into the instance
  const definitionSnapshot = original.workflowVersionId
    ? ((await deps.workflowVersions.getById(original.workflowVersionId))?.definition ?? original.definitionSnapshot)
    : original.definitionSnapshot;

  return await deps.orchestrator.submit({
    workflowId: original.workflowId,
    workflowVersionId: original.workflowVersionId,
    workflowNameSnapshot: original.workflowNameSnapshot,
    workflowScopeSnapshot: original.workflowScopeSnapshot,
    definitionSnapshot,
    inputs: original.inputs ?? {},
    startedByUserId: opts.startedByUserId ?? original.startedByUserId,
    startedByOrgId: opts.startedByOrgId ?? null,
  });
}
