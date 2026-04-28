import type {
  Flow, FlowVersion, IFlowStore, IFlowVersionStore, IRunStore,
} from "@journeyman/core";

export interface ForkDeps {
  runs: IRunStore;
  flows: IFlowStore;
  flowVersions: IFlowVersionStore;
}

/**
 * Create a brand-new Flow whose initial version mirrors the run's version.
 * The original flow is untouched. The user can edit the new flow freely
 * and Run it as a fresh run.
 */
export async function forkFromRun(
  deps: ForkDeps,
  originalRunId: string,
  opts: { name?: string; createdByUserId?: string | null; ownerUserId?: string | null } = {},
): Promise<{ flow: Flow; version: FlowVersion }> {
  const run = await deps.runs.getById(originalRunId);
  if (!run) throw new Error(`Run not found: ${originalRunId}`);

  // flowVersionId is advisory/nullable — fall back to the definition snapshot baked into the run
  const definition = run.flowVersionId
    ? ((await deps.flowVersions.getById(run.flowVersionId))?.definition ?? run.definitionSnapshot)
    : run.definitionSnapshot;

  const name = opts.name ?? `Fork of run ${originalRunId.slice(0, 8)}`;
  return await deps.flows.create({
    scope: run.flowScopeSnapshot,
    orgId: null,
    name,
    description: `Forked from run ${originalRunId}.`,
    ownerUserId: opts.ownerUserId ?? run.startedByUserId ?? null,
    initialDefinition: definition,
    createdByUserId: opts.createdByUserId ?? run.startedByUserId ?? null,
  });
}
