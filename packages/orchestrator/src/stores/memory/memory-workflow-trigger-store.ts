import { randomUUID } from "node:crypto";
import type {
  IWorkflowTriggerStore,
  UpsertWorkflowTriggerArgs,
  WorkflowTriggerIndexRow,
} from "@journeyman/core";

export class MemoryWorkflowTriggerStore implements IWorkflowTriggerStore {
  private rows: WorkflowTriggerIndexRow[] = [];

  async replaceForVersion(workflowVersionId: string, rows: UpsertWorkflowTriggerArgs[]): Promise<void> {
    this.rows = this.rows.filter((r) => r.workflowVersionId !== workflowVersionId);
    for (const a of rows) {
      this.rows.push({
        id: randomUUID(),
        workflowId: a.workflowId,
        workflowVersionId: a.workflowVersionId,
        triggerNodeId: a.triggerNodeId,
        kind: a.kind,
        webhookId: a.webhookId,
        isActive: false,
        createdAt: new Date(),
      });
    }
  }

  async setActiveForWorkflow(workflowId: string, workflowVersionId: string | null): Promise<void> {
    this.rows = this.rows.map((r) => {
      if (r.workflowId !== workflowId) return r;
      return { ...r, isActive: workflowVersionId !== null && r.workflowVersionId === workflowVersionId };
    });
  }

  async findActiveWebhookTriggers(webhookId: string): Promise<WorkflowTriggerIndexRow[]> {
    return this.rows.filter((r) => r.isActive && r.kind === "webhook" && r.webhookId === webhookId);
  }

  async listForWorkflow(workflowId: string): Promise<WorkflowTriggerIndexRow[]> {
    return this.rows.filter((r) => r.workflowId === workflowId);
  }
}
