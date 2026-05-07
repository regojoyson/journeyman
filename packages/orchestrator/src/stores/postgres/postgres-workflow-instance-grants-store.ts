import type { Pool } from "pg";
import {
  effectiveRole,
  type ActorContext, type CreateWorkflowInstanceGrantArgs, type IWorkflowInstanceGrantsStore,
  type WorkflowInstanceGrant, type WorkflowInstanceGrantRole,
} from "@journeyman/core";

function rowToGrant(r: any): WorkflowInstanceGrant {
  return {
    id: r.id,
    workflowInstanceId: r.workflow_instance_id,
    principalType: r.principal_type,
    principalId: r.principal_id,
    role: r.role,
    createdAt: new Date(r.created_at),
    createdBy: r.created_by,
  };
}

export class PostgresWorkflowInstanceGrantsStore implements IWorkflowInstanceGrantsStore {
  constructor(private pool: Pool) {}

  async createForInstance(
    workflowInstanceId: string,
    grants: Omit<CreateWorkflowInstanceGrantArgs, "workflowInstanceId">[],
  ): Promise<WorkflowInstanceGrant[]> {
    if (grants.length === 0) return [];
    const values: string[] = [];
    const params: any[] = [];
    let i = 1;
    for (const g of grants) {
      values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(workflowInstanceId, g.principalType, g.principalId, g.role, g.createdBy);
    }
    const { rows } = await this.pool.query(
      `INSERT INTO jm_workflow_instance_grants (workflow_instance_id, principal_type, principal_id, role, created_by)
       VALUES ${values.join(", ")}
       RETURNING *`,
      params,
    );
    return rows.map(rowToGrant);
  }

  async listByInstance(workflowInstanceId: string): Promise<WorkflowInstanceGrant[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_workflow_instance_grants WHERE workflow_instance_id = $1 ORDER BY created_at",
      [workflowInstanceId],
    );
    return rows.map(rowToGrant);
  }

  async matchForActor(
    actor: ActorContext,
    workflowInstanceIds: string[],
  ): Promise<Map<string, WorkflowInstanceGrantRole>> {
    const out = new Map<string, WorkflowInstanceGrantRole>();
    if (workflowInstanceIds.length === 0) return out;

    if (actor.isPlatformAdmin) {
      for (const id of workflowInstanceIds) out.set(id, "owner");
      return out;
    }

    const { rows } = await this.pool.query(
      `SELECT * FROM jm_workflow_instance_grants
        WHERE workflow_instance_id = ANY($1::uuid[])
          AND (
            principal_type = 'global'
            OR (principal_type = 'user' AND principal_id = $2)
            OR (principal_type = 'org'  AND principal_id = $3)
          )`,
      [workflowInstanceIds, actor.userId, actor.orgId],
    );
    const byInstance = new Map<string, WorkflowInstanceGrant[]>();
    for (const r of rows) {
      const g = rowToGrant(r);
      const arr = byInstance.get(g.workflowInstanceId) ?? [];
      arr.push(g);
      byInstance.set(g.workflowInstanceId, arr);
    }
    for (const id of workflowInstanceIds) {
      const role = effectiveRole(actor, byInstance.get(id) ?? []);
      if (role) out.set(id, role);
    }
    return out;
  }
}
