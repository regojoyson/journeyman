import type { Pool } from "pg";
import type {
  CreateWorkflowGrantArgs, WorkflowGrant, IWorkflowGrantsStore,
} from "@journeyman/core";

function rowToGrant(r: any): WorkflowGrant {
  return {
    id: r.id,
    workflowId: r.workflow_id,
    principalType: r.principal_type,
    principalId: r.principal_id,
    role: r.role,
    createdAt: new Date(r.created_at),
    createdBy: r.created_by,
  };
}

export class PostgresWorkflowGrantsStore implements IWorkflowGrantsStore {
  constructor(private pool: Pool) {}

  async create(args: CreateWorkflowGrantArgs): Promise<WorkflowGrant> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_workflow_grants (workflow_id, principal_type, principal_id, role, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [args.workflowId, args.principalType, args.principalId, args.role, args.createdBy],
    );
    return rowToGrant(rows[0]);
  }

  async listByWorkflow(workflowId: string): Promise<WorkflowGrant[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_workflow_grants WHERE workflow_id = $1 ORDER BY created_at",
      [workflowId],
    );
    return rows.map(rowToGrant);
  }

  async listForCaller(args: {
    callerUserId: string | null;
    callerOrgId: string | null;
  }): Promise<WorkflowGrant[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_workflow_grants
        WHERE principal_type = 'global'
           OR (principal_type = 'user' AND principal_id = $1)
           OR (principal_type = 'org'  AND principal_id = $2)`,
      [args.callerUserId, args.callerOrgId],
    );
    return rows.map(rowToGrant);
  }

  async delete(grantId: string): Promise<void> {
    await this.pool.query("DELETE FROM jm_workflow_grants WHERE id = $1", [grantId]);
  }

  async getOwnerGrant(workflowId: string): Promise<WorkflowGrant | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_workflow_grants WHERE workflow_id = $1 AND role = 'owner' LIMIT 1",
      [workflowId],
    );
    return rows[0] ? rowToGrant(rows[0]) : null;
  }
}
