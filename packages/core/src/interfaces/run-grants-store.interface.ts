import type {
  ActorContext, CreateRunGrantArgs, RunGrant, RunGrantRole,
} from "../types/run-grants.types.ts";

export interface IRunGrantsStore {
  createForRun(runId: string, grants: Omit<CreateRunGrantArgs, "runId">[]): Promise<RunGrant[]>;
  listByRun(runId: string): Promise<RunGrant[]>;
  /**
   * Resolve effective role per run for the given actor. Used for hydrating
   * `effectiveRole` on list/detail responses without N+1 queries.
   */
  matchForActor(actor: ActorContext, runIds: string[]): Promise<Map<string, RunGrantRole>>;
}
