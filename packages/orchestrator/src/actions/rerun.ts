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
  opts: { startedByUserId?: string | null; startedByOrgId?: string | null } = {},
): Promise<RerunResult> {
  const original = await deps.runs.getById(originalRunId);
  if (!original) throw new Error(`Run not found: ${originalRunId}`);

  // flowVersionId is advisory/nullable — fall back to the definition snapshot baked into the run
  const definitionSnapshot = original.flowVersionId
    ? ((await deps.flowVersions.getById(original.flowVersionId))?.definition ?? original.definitionSnapshot)
    : original.definitionSnapshot;

  return await deps.orchestrator.submit({
    flowId: original.flowId,
    flowVersionId: original.flowVersionId,
    flowNameSnapshot: original.flowNameSnapshot,
    flowScopeSnapshot: original.flowScopeSnapshot,
    definitionSnapshot,
    inputs: original.inputs ?? {},
    startedByUserId: opts.startedByUserId ?? original.startedByUserId,
    startedByOrgId: opts.startedByOrgId ?? null,
  });
}
