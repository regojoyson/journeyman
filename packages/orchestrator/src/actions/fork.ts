import type {
  Workflow, WorkflowVersion, IWorkflowStore, IWorkflowVersionStore, IWorkflowInstanceStore,
} from "@journeyman/core";

export interface ForkDeps {
  workflowInstances: IWorkflowInstanceStore;
  workflows: IWorkflowStore;
  workflowVersions: IWorkflowVersionStore;
}

/**
 * Create a brand-new Workflow whose initial version mirrors the instance's version.
 * The original workflow is untouched. The user can edit the new workflow freely
 * and run it as a fresh workflow instance.
 */
export async function forkFromWorkflowInstance(
  deps: ForkDeps,
  originalWorkflowInstanceId: string,
  opts: { name?: string; createdByUserId?: string | null; ownerUserId?: string | null } = {},
): Promise<{ workflow: Workflow; version: WorkflowVersion }> {
  const instance = await deps.workflowInstances.getById(originalWorkflowInstanceId);
  if (!instance) throw new Error(`WorkflowInstance not found: ${originalWorkflowInstanceId}`);

  // workflowVersionId is advisory/nullable — fall back to the definition snapshot baked into the instance
  const definition = instance.workflowVersionId
    ? ((await deps.workflowVersions.getById(instance.workflowVersionId))?.definition ?? instance.definitionSnapshot)
    : instance.definitionSnapshot;

  if (!instance.workspaceId) {
    throw new Error(`Cannot fork instance ${originalWorkflowInstanceId}: no workspace`);
  }
  const name = opts.name ?? `Fork of instance ${originalWorkflowInstanceId.slice(0, 8)}`;
  return await deps.workflows.create({
    workspaceId: instance.workspaceId,
    name,
    description: `Forked from workflow instance ${originalWorkflowInstanceId}.`,
    initialDefinition: definition,
    createdByUserId: opts.createdByUserId ?? instance.startedByUserId ?? null,
  });
}
