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
  /** How this instance was started; defaults to "manual" if omitted by the caller. */
  triggerSource?: "manual" | "webhook" | "schedule" | "api" | "human";
  /** The trigger node id that fired (id of the trigger-manual/webhook/human node). */
  triggerNodeId?: string | null;
  /** Webhook event id when triggerSource === "webhook". */
  webhookEventId?: string | null;
  /** Form submission id when triggerSource === "human". */
  formSubmissionId?: string | null;
  /** Optional issueRef for cross-instance correlation (e.g. extracted via trigger-webhook.issueRefFromPath). */
  issueRef?: string | null;
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
