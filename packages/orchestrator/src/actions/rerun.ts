import type {
  IFlowVersionStore, IOrchestratorEngine, IRunStore,
} from "@journeyman/core";

export interface RerunDeps {
  runs: IRunStore;
  flowVersions: IFlowVersionStore;
  orchestrator: IOrchestratorEngine;
}

export interface RerunResult {
  runId: string;
  engineWorkflowId: string;
}

/** Submit a fresh run with the same flow version + same inputs as `originalRunId`. */
export async function rerunFromExisting(
  deps: RerunDeps,
  originalRunId: string,
  opts: { startedByUserId?: string | null } = {},
): Promise<RerunResult> {
  const original = await deps.runs.getById(originalRunId);
  if (!original) throw new Error(`Run not found: ${originalRunId}`);
  const version = await deps.flowVersions.getById(original.flowVersionId);
  if (!version) throw new Error(`Flow version not found: ${original.flowVersionId}`);

  return await deps.orchestrator.submit({
    flowVersionId: version.id,
    flowDefinition: version.definition,
    inputs: original.inputs ?? {},
    startedByUserId: opts.startedByUserId ?? original.startedByUserId,
  });
}
