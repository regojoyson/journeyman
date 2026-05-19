import type { Pool } from "pg";
import type {
  CreateWorkflowArgs, Workflow, WorkflowGrant, WorkflowGraph, WorkflowListFilter,
  WorkflowStatus, WorkflowVersion,
  IWorkflowGrantsStore, IWorkflowStore, IWorkflowVersionStore,
} from "@journeyman/core";

function rowToWorkflowBase(row: any): Omit<Workflow, "scope" | "orgId" | "ownerUserId"> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    currentVersionId: row.current_version_id,
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    status: row.status as WorkflowStatus,
  };
}

function hydrateFromOwnerGrant(
  base: Omit<Workflow, "scope" | "orgId" | "ownerUserId">,
  ownerGrant: WorkflowGrant | null,
  ownerOrgIdHint: string | null,
): Workflow {
  if (!ownerGrant) {
    return { ...base, scope: "user", orgId: null, ownerUserId: null };
  }
  switch (ownerGrant.principalType) {
    case "global":
      return { ...base, scope: "global", orgId: null, ownerUserId: null };
    case "org":
      return { ...base, scope: "org", orgId: ownerGrant.principalId, ownerUserId: null };
    case "user":
      return { ...base, scope: "user", orgId: ownerOrgIdHint, ownerUserId: ownerGrant.principalId };
  }
}

function rowToVersion(row: any): WorkflowVersion {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    versionNumber: row.version_number,
    definition: row.definition as WorkflowGraph,
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at),
  };
}

export class PostgresWorkflowVersionStore implements IWorkflowVersionStore {
  constructor(private pool: Pool) {}

  async appendVersion(args: {
    workflowId: string;
    definition: WorkflowGraph;
    createdByUserId: string | null;
  }): Promise<WorkflowVersion> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_workflow_versions (workflow_id, version_number, definition, created_by_user_id)
       VALUES ($1,
               COALESCE((SELECT MAX(version_number) + 1 FROM jm_workflow_versions WHERE workflow_id = $1), 1),
               $2::jsonb, $3)
       RETURNING *`,
      [args.workflowId, JSON.stringify(args.definition), args.createdByUserId],
    );
    await this.pool.query("UPDATE jm_workflows SET current_version_id = $1, updated_at = now() WHERE id = $2", [rows[0].id, args.workflowId]);
    return rowToVersion(rows[0]);
  }

  async getById(versionId: string): Promise<WorkflowVersion | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_workflow_versions WHERE id = $1", [versionId],
    );
    return rows[0] ? rowToVersion(rows[0]) : null;
  }

  async listByWorkflow(workflowId: string): Promise<WorkflowVersion[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_workflow_versions WHERE workflow_id = $1 ORDER BY version_number", [workflowId],
    );
    return rows.map(rowToVersion);
  }
}

export class PostgresWorkflowStore implements IWorkflowStore {
  constructor(
    private pool: Pool,
    private versions: PostgresWorkflowVersionStore,
    private grants: IWorkflowGrantsStore,
  ) {}

  async create(args: CreateWorkflowArgs): Promise<{ workflow: Workflow; version: WorkflowVersion }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      const workflowRes = await client.query(
        `INSERT INTO jm_workflows (name, description, created_by_user_id)
         VALUES ($1, $2, $3) RETURNING *`,
        [args.name, args.description ?? null, args.createdByUserId],
      );
      const workflowId = workflowRes.rows[0].id;

      const verRes = await client.query(
        `INSERT INTO jm_workflow_versions (workflow_id, version_number, definition, created_by_user_id)
         VALUES ($1, 1, $2::jsonb, $3) RETURNING *`,
        [workflowId, JSON.stringify(args.initialDefinition), args.createdByUserId],
      );
      await client.query(
        "UPDATE jm_workflows SET current_version_id = $1 WHERE id = $2",
        [verRes.rows[0].id, workflowId],
      );

      const principalType = args.scope;
      const principalId =
        args.scope === "user"   ? args.ownerUserId :
        args.scope === "org"    ? args.orgId       :
        /* global */              null;
      await client.query(
        `INSERT INTO jm_workflow_grants (workflow_id, principal_type, principal_id, role, created_by)
         VALUES ($1, $2, $3, 'owner', $4)`,
        [workflowId, principalType, principalId, args.createdByUserId],
      );

      const finalWorkflow = await client.query("SELECT * FROM jm_workflows WHERE id = $1", [workflowId]);
      await client.query("COMMIT");

      const base = rowToWorkflowBase(finalWorkflow.rows[0]);
      const owner = await this.grants.getOwnerGrant(workflowId);
      const orgHint = args.scope === "user" ? args.orgId : null;
      return {
        workflow: hydrateFromOwnerGrant(base, owner, orgHint),
        version: rowToVersion(verRes.rows[0]),
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getById(workflowId: string): Promise<Workflow | null> {
    const { rows } = await this.pool.query("SELECT * FROM jm_workflows WHERE id = $1", [workflowId]);
    if (!rows[0]) return null;
    const base = rowToWorkflowBase(rows[0]);
    const owner = await this.grants.getOwnerGrant(workflowId);
    const orgHint = await this.resolveUserPrimaryOrgId(owner);
    const workflow = hydrateFromOwnerGrant(base, owner, orgHint);
    workflow.grants = await this.grants.listByWorkflow(workflowId);
    return workflow;
  }

  private buildWhereClause(filter: Omit<WorkflowListFilter, "limit" | "offset">): { where: string; params: any[] } {
    const params: any[] = [];
    const push = (v: any) => { params.push(v); return `$${params.length}`; };

    const conds: string[] = [];

    if (filter.callerIsPlatformAdmin) {
      // No grant predicate; all rows visible.
    } else {
      const userP = push(filter.callerUserId);
      const orgP  = push(filter.callerOrgId);
      const orClauses: string[] = [
        `EXISTS (SELECT 1 FROM jm_workflow_grants g WHERE g.workflow_id = f.id AND g.principal_type = 'global')`,
        `EXISTS (SELECT 1 FROM jm_workflow_grants g WHERE g.workflow_id = f.id AND g.principal_type = 'user' AND g.principal_id = ${userP})`,
        `EXISTS (SELECT 1 FROM jm_workflow_grants g WHERE g.workflow_id = f.id AND g.principal_type = 'org'  AND g.principal_id = ${orgP})`,
      ];
      if (filter.callerIsOrgAdmin && filter.callerOrgId) {
        orClauses.push(
          `EXISTS (
             SELECT 1 FROM jm_workflow_grants g
             JOIN jm_memberships m ON m.user_id = g.principal_id AND m.org_id = ${orgP}
             WHERE g.workflow_id = f.id AND g.principal_type = 'user' AND g.role = 'owner'
           )`,
        );
      }
      conds.push(`(${orClauses.join(" OR ")})`);
    }

    if (filter.scope) {
      const sp = push(filter.scope);
      conds.push(`EXISTS (SELECT 1 FROM jm_workflow_grants g WHERE g.workflow_id = f.id AND g.role = 'owner' AND g.principal_type = ${sp})`);
    }
    if (filter.orgId) {
      const op = push(filter.orgId);
      conds.push(`EXISTS (
        SELECT 1 FROM jm_workflow_grants g
        WHERE g.workflow_id = f.id AND g.role = 'owner' AND (
          g.principal_type = 'org' AND g.principal_id = ${op}
          OR g.principal_type = 'user' AND EXISTS (
            SELECT 1 FROM jm_memberships m WHERE m.user_id = g.principal_id AND m.org_id = ${op}
          )
        )
      )`);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    return { where, params };
  }

  async list(filter: WorkflowListFilter): Promise<Workflow[]> {
    const { where, params } = this.buildWhereClause(filter);
    const limit = filter.limit ? `LIMIT ${Number(filter.limit)}` : "LIMIT 200";
    const offset = filter.offset ? `OFFSET ${Number(filter.offset)}` : "";
    const sql = `SELECT f.* FROM jm_workflows f ${where} ORDER BY f.created_at DESC ${limit} ${offset}`;
    const { rows } = await this.pool.query(sql, params);

    const out: Workflow[] = [];
    for (const r of rows) {
      const base = rowToWorkflowBase(r);
      const owner = await this.grants.getOwnerGrant(r.id);
      const orgHint = await this.resolveUserPrimaryOrgId(owner);
      out.push(hydrateFromOwnerGrant(base, owner, orgHint));
    }
    return out;
  }

  async count(filter: Omit<WorkflowListFilter, "limit" | "offset">): Promise<number> {
    const { where, params } = this.buildWhereClause(filter);
    const sql = `SELECT COUNT(*)::int AS n FROM jm_workflows f ${where}`;
    const { rows } = await this.pool.query(sql, params);
    return rows[0]?.n ?? 0;
  }

  async updateMeta(workflowId: string, patch: { name?: string; description?: string | null }): Promise<Workflow | null> {
    const sets: string[] = [];
    const params: any[] = [];
    const push = (v: any) => { params.push(v); return `$${params.length}`; };
    if (patch.name !== undefined)        sets.push(`name = ${push(patch.name)}`);
    if (patch.description !== undefined) sets.push(`description = ${push(patch.description)}`);
    if (sets.length === 0) return this.getById(workflowId);
    sets.push("updated_at = now()");
    params.push(workflowId);
    await this.pool.query(`UPDATE jm_workflows SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    return this.getById(workflowId);
  }

  async setStatus(workflowId: string, status: WorkflowStatus): Promise<Workflow | null> {
    const { rows } = await this.pool.query(
      "UPDATE jm_workflows SET status = $1, updated_at = now() WHERE id = $2 RETURNING id",
      [status, workflowId],
    );
    if (!rows[0]) return null;
    return this.getById(workflowId);
  }

  async delete(workflowId: string): Promise<void> {
    await this.pool.query("DELETE FROM jm_workflows WHERE id = $1", [workflowId]);
  }

  private async resolveUserPrimaryOrgId(owner: WorkflowGrant | null): Promise<string | null> {
    if (!owner || owner.principalType !== "user" || !owner.principalId) return null;
    const r = await this.pool.query(
      "SELECT org_id FROM jm_memberships WHERE user_id = $1 ORDER BY created_at LIMIT 1",
      [owner.principalId],
    );
    return r.rows[0]?.org_id ?? null;
  }
}
