import { randomUUID } from "node:crypto";
import type {
  CreateWorkflowGrantArgs, WorkflowGrant, IWorkflowGrantsStore,
} from "@journeyman/core";

export class MemoryWorkflowGrantsStore implements IWorkflowGrantsStore {
  private rows = new Map<string, WorkflowGrant>();

  async create(args: CreateWorkflowGrantArgs): Promise<WorkflowGrant> {
    const g: WorkflowGrant = {
      id: randomUUID(),
      workflowId: args.workflowId,
      principalType: args.principalType,
      principalId: args.principalId,
      role: args.role,
      createdAt: new Date(),
      createdBy: args.createdBy,
    };
    this.rows.set(g.id, g);
    return g;
  }

  async listByWorkflow(workflowId: string): Promise<WorkflowGrant[]> {
    return [...this.rows.values()].filter(g => g.workflowId === workflowId);
  }

  async listForCaller(args: { callerUserId: string | null; callerOrgId: string | null }): Promise<WorkflowGrant[]> {
    return [...this.rows.values()].filter(g =>
      g.principalType === "global"
      || (g.principalType === "user" && g.principalId === args.callerUserId)
      || (g.principalType === "org"  && g.principalId === args.callerOrgId),
    );
  }

  async delete(grantId: string): Promise<void> { this.rows.delete(grantId); }

  async getOwnerGrant(workflowId: string): Promise<WorkflowGrant | null> {
    return [...this.rows.values()].find(g => g.workflowId === workflowId && g.role === "owner") ?? null;
  }
}
