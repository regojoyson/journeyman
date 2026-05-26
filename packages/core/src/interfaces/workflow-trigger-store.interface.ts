export type WorkflowTriggerKind = "manual" | "webhook" | "human";

export interface WorkflowTriggerIndexRow {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  triggerNodeId: string;
  kind: WorkflowTriggerKind;
  webhookId: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface UpsertWorkflowTriggerArgs {
  workflowId: string;
  workflowVersionId: string;
  triggerNodeId: string;
  kind: WorkflowTriggerKind;
  webhookId: string | null;
}

/**
 * Denormalized index of trigger nodes across published workflow versions.
 * Maintained by api-server on publish/unpublish/promote so the webhook ingest
 * pipeline can look up active webhook triggers without scanning every
 * workflow's JSON definition.
 */
export interface IWorkflowTriggerStore {
  /** Replace the full set of trigger rows for a workflow version. */
  replaceForVersion(workflowVersionId: string, rows: UpsertWorkflowTriggerArgs[]): Promise<void>;
  /** Mark only this version's rows active for a workflow; clear is_active on all others for the same workflow. Pass null to deactivate all rows for the workflow. */
  setActiveForWorkflow(workflowId: string, workflowVersionId: string | null): Promise<void>;
  /** Return all active webhook triggers for a given webhookId. */
  findActiveWebhookTriggers(webhookId: string): Promise<WorkflowTriggerIndexRow[]>;
  /** Return all trigger rows for a workflow (any version). */
  listForWorkflow(workflowId: string): Promise<WorkflowTriggerIndexRow[]>;
}
