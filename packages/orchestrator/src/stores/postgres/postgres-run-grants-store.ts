import type { Pool } from "pg";
import {
  effectiveRole,
  type ActorContext, type CreateRunGrantArgs, type IRunGrantsStore,
  type RunGrant, type RunGrantRole,
} from "@journeyman/core";

function rowToGrant(r: any): RunGrant {
  return {
    id: r.id,
    runId: r.run_id,
    principalType: r.principal_type,
    principalId: r.principal_id,
    role: r.role,
    createdAt: new Date(r.created_at),
    createdBy: r.created_by,
  };
}

export class PostgresRunGrantsStore implements IRunGrantsStore {
  constructor(private pool: Pool) {}

  async createForRun(
    runId: string,
    grants: Omit<CreateRunGrantArgs, "runId">[],
  ): Promise<RunGrant[]> {
    if (grants.length === 0) return [];
    const values: string[] = [];
    const params: any[] = [];
    let i = 1;
    for (const g of grants) {
      values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(runId, g.principalType, g.principalId, g.role, g.createdBy);
    }
    const { rows } = await this.pool.query(
      `INSERT INTO jm_run_grants (run_id, principal_type, principal_id, role, created_by)
       VALUES ${values.join(", ")}
       RETURNING *`,
      params,
    );
    return rows.map(rowToGrant);
  }

  async listByRun(runId: string): Promise<RunGrant[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_run_grants WHERE run_id = $1 ORDER BY created_at",
      [runId],
    );
    return rows.map(rowToGrant);
  }

  async matchForActor(
    actor: ActorContext,
    runIds: string[],
  ): Promise<Map<string, RunGrantRole>> {
    const out = new Map<string, RunGrantRole>();
    if (runIds.length === 0) return out;

    if (actor.isPlatformAdmin) {
      for (const id of runIds) out.set(id, "owner");
      return out;
    }

    const { rows } = await this.pool.query(
      `SELECT * FROM jm_run_grants
        WHERE run_id = ANY($1::uuid[])
          AND (
            principal_type = 'global'
            OR (principal_type = 'user' AND principal_id = $2)
            OR (principal_type = 'org'  AND principal_id = $3)
          )`,
      [runIds, actor.userId, actor.orgId],
    );
    const byRun = new Map<string, RunGrant[]>();
    for (const r of rows) {
      const g = rowToGrant(r);
      const arr = byRun.get(g.runId) ?? [];
      arr.push(g);
      byRun.set(g.runId, arr);
    }
    for (const id of runIds) {
      const role = effectiveRole(actor, byRun.get(id) ?? []);
      if (role) out.set(id, role);
    }
    return out;
  }
}
