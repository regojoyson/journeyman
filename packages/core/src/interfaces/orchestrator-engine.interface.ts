import type { WorkflowGraph } from "../types/flow.types.ts";
import type { WorkflowInstance, WorkflowInstanceStatus } from "../types/workflow-instance.types.ts";

export interface SubmitWorkflowInstanceArgs {
  workflowId: string | null;
  workflowVersionId: string | null;
  workflowNameSnapshot: string;
  workflowScopeSnapshot: "user" | "org" | "global";
  definitionSnapshot: WorkflowGraph;
  inputs: Record<string, unknown>;
  startedByUserId: string | null;
  /** Caller's org at instance-start. Null when the caller has no org context. */
  startedByOrgId: string | null;
}

export interface IOrchestratorEngine {
  /** Hand a workflow to the engine. Returns the persisted WorkflowInstance id. */
  submit(args: SubmitWorkflowInstanceArgs): Promise<{ workflowInstanceId: string; engineWorkflowId: string }>;
  /** Fetch current state. */
  getWorkflowInstance(workflowInstanceId: string): Promise<WorkflowInstance | null>;
  /** Best-effort cancel. */
  cancel(workflowInstanceId: string, reason?: string): Promise<void>;
  /** Engine-specific status sync — pulled by the API server periodically until SSE lands. */
  syncStatus(workflowInstanceId: string): Promise<WorkflowInstanceStatus>;
}
