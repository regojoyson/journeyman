import type { FlowGraph } from "../types/flow.types.ts";
import type { Run, RunStatus } from "../types/run.types.ts";

export interface SubmitRunArgs {
  flowId: string | null;
  flowVersionId: string | null;
  flowNameSnapshot: string;
  flowScopeSnapshot: "user" | "org" | "global";
  definitionSnapshot: FlowGraph;
  inputs: Record<string, unknown>;
  startedByUserId: string | null;
  /** Caller's org at run-start. Null when the caller has no org context. */
  startedByOrgId: string | null;
}

export interface IOrchestratorEngine {
  /** Hand a flow to the engine. Returns the persisted Run id. */
  submit(args: SubmitRunArgs): Promise<{ runId: string; engineWorkflowId: string }>;
  /** Fetch current state. */
  getRun(runId: string): Promise<Run | null>;
  /** Best-effort cancel. */
  cancel(runId: string, reason?: string): Promise<void>;
  /** Engine-specific status sync — pulled by the API server periodically until SSE lands. */
  syncStatus(runId: string): Promise<RunStatus>;
}
