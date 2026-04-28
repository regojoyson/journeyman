import type { Pool } from "pg";
import type {
  CreateGrantArgs, FlowGrant, IFlowGrantsStore,
} from "@journeyman/core";

function rowToGrant(r: any): FlowGrant {
  return {
    id: r.id,
    flowId: r.flow_id,
    principalType: r.principal_type,
    principalId: r.principal_id,
    role: r.role,
    createdAt: new Date(r.created_at),
    createdBy: r.created_by,
  };
}

export class PostgresFlowGrantsStore implements IFlowGrantsStore {
  constructor(private pool: Pool) {}

  async create(args: CreateGrantArgs): Promise<FlowGrant> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_flow_grants (flow_id, principal_type, principal_id, role, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [args.flowId, args.principalType, args.principalId, args.role, args.createdBy],
    );
    return rowToGrant(rows[0]);
  }

  async listByFlow(flowId: string): Promise<FlowGrant[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_flow_grants WHERE flow_id = $1 ORDER BY created_at",
      [flowId],
    );
    return rows.map(rowToGrant);
  }

  async listForCaller(args: {
    callerUserId: string | null;
    callerOrgId: string | null;
  }): Promise<FlowGrant[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_flow_grants
        WHERE principal_type = 'global'
           OR (principal_type = 'user' AND principal_id = $1)
           OR (principal_type = 'org'  AND principal_id = $2)`,
      [args.callerUserId, args.callerOrgId],
    );
    return rows.map(rowToGrant);
  }

  async delete(grantId: string): Promise<void> {
    await this.pool.query("DELETE FROM jm_flow_grants WHERE id = $1", [grantId]);
  }

  async getOwnerGrant(flowId: string): Promise<FlowGrant | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_flow_grants WHERE flow_id = $1 AND role = 'owner' LIMIT 1",
      [flowId],
    );
    return rows[0] ? rowToGrant(rows[0]) : null;
  }
}
