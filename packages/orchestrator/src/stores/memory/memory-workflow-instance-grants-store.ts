import { randomUUID } from "node:crypto";
import {
  effectiveRole,
  type ActorContext, type CreateWorkflowInstanceGrantArgs, type IWorkflowInstanceGrantsStore,
  type WorkflowInstanceGrant, type WorkflowInstanceGrantRole,
} from "@journeyman/core";

export class MemoryWorkflowInstanceGrantsStore implements IWorkflowInstanceGrantsStore {
  private rows = new Map<string, WorkflowInstanceGrant>();

  async createForInstance(
    workflowInstanceId: string,
    grants: Omit<CreateWorkflowInstanceGrantArgs, "workflowInstanceId">[],
  ): Promise<WorkflowInstanceGrant[]> {
    const out: WorkflowInstanceGrant[] = [];
    for (const g of grants) {
      const row: WorkflowInstanceGrant = {
        id: randomUUID(),
        workflowInstanceId,
        principalType: g.principalType,
        principalId: g.principalId,
        role: g.role,
        createdAt: new Date(),
        createdBy: g.createdBy,
      };
      this.rows.set(row.id, row);
      out.push(row);
    }
    return out;
  }

  async listByInstance(workflowInstanceId: string): Promise<WorkflowInstanceGrant[]> {
    return [...this.rows.values()].filter(g => g.workflowInstanceId === workflowInstanceId);
  }

  async matchForActor(
    actor: ActorContext,
    workflowInstanceIds: string[],
  ): Promise<Map<string, WorkflowInstanceGrantRole>> {
    const wanted = new Set(workflowInstanceIds);
    const byInstance = new Map<string, WorkflowInstanceGrant[]>();
    for (const g of this.rows.values()) {
      if (!wanted.has(g.workflowInstanceId)) continue;
      const arr = byInstance.get(g.workflowInstanceId) ?? [];
      arr.push(g);
      byInstance.set(g.workflowInstanceId, arr);
    }
    const out = new Map<string, WorkflowInstanceGrantRole>();
    for (const id of workflowInstanceIds) {
      const role = effectiveRole(actor, byInstance.get(id) ?? []);
      if (role) out.set(id, role);
      else if (actor.isPlatformAdmin) out.set(id, "owner");
    }
    return out;
  }
}
