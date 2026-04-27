import type { FlowGraph } from "../types/flow.types.ts";
import type { Run, RunStatus } from "../types/run.types.ts";

export interface SubmitRunArgs {
  flowVersionId: string;
  flowDefinition: FlowGraph;
  inputs: Record<string, unknown>;
  startedByUserId: string | null;
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
