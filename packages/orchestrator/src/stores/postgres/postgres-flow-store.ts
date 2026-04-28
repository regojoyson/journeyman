import type { Pool } from "pg";
import type {
  CreateFlowArgs, Flow, FlowGrant, FlowGraph, FlowListFilter, FlowVersion,
  IFlowGrantsStore, IFlowStore, IFlowVersionStore,
} from "@journeyman/core";

function rowToFlowBase(row: any): Omit<Flow, "scope" | "orgId" | "ownerUserId"> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    currentVersionId: row.current_version_id,
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function hydrateFromOwnerGrant(
  base: Omit<Flow, "scope" | "orgId" | "ownerUserId">,
  ownerGrant: FlowGrant | null,
  ownerOrgIdHint: string | null,
): Flow {
  // ownerOrgIdHint: when ownerGrant.principal_type='user' we don't know the org from the grant alone.
  // Caller supplies the user's primary org id (resolved via memberships) — null when unknown.
  if (!ownerGrant) {
    // Defensive: should never happen post-migration. Treat as 'user' scope with null pointers.
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

function rowToVersion(row: any): FlowVersion {
  return {
    id: row.id,
    flowId: row.flow_id,
    versionNumber: row.version_number,
    definition: row.definition as FlowGraph,
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at),
  };
}

export class PostgresFlowVersionStore implements IFlowVersionStore {
  constructor(private pool: Pool) {}

  async appendVersion(args: {
    flowId: string;
    definition: FlowGraph;
    createdByUserId: string | null;
  }): Promise<FlowVersion> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_flow_versions (flow_id, version_number, definition, created_by_user_id)
       VALUES ($1,
               COALESCE((SELECT MAX(version_number) + 1 FROM jm_flow_versions WHERE flow_id = $1), 1),
               $2::jsonb, $3)
       RETURNING *`,
      [args.flowId, JSON.stringify(args.definition), args.createdByUserId],
    );
    await this.pool.query("UPDATE jm_flows SET current_version_id = $1, updated_at = now() WHERE id = $2", [rows[0].id, args.flowId]);
    return rowToVersion(rows[0]);
  }

  async getById(versionId: string): Promise<FlowVersion | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_flow_versions WHERE id = $1", [versionId],
    );
    return rows[0] ? rowToVersion(rows[0]) : null;
  }

  async listByFlow(flowId: string): Promise<FlowVersion[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_flow_versions WHERE flow_id = $1 ORDER BY version_number", [flowId],
    );
    return rows.map(rowToVersion);
  }
}

export class PostgresFlowStore implements IFlowStore {
  constructor(
    private pool: Pool,
    private versions: PostgresFlowVersionStore,
    private grants: IFlowGrantsStore,
  ) {}

  async create(args: CreateFlowArgs): Promise<{ flow: Flow; version: FlowVersion }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      const flowRes = await client.query(
        `INSERT INTO jm_flows (name, description, created_by_user_id)
         VALUES ($1, $2, $3) RETURNING *`,
        [args.name, args.description ?? null, args.createdByUserId],
      );
      const flowId = flowRes.rows[0].id;

      const verRes = await client.query(
        `INSERT INTO jm_flow_versions (flow_id, version_number, definition, created_by_user_id)
         VALUES ($1, 1, $2::jsonb, $3) RETURNING *`,
        [flowId, JSON.stringify(args.initialDefinition), args.createdByUserId],
      );
      await client.query(
        "UPDATE jm_flows SET current_version_id = $1 WHERE id = $2",
        [verRes.rows[0].id, flowId],
      );

      // Owner grant.
      const principalType = args.scope;
      const principalId =
        args.scope === "user"   ? args.ownerUserId :
        args.scope === "org"    ? args.orgId       :
        /* global */              null;
      await client.query(
        `INSERT INTO jm_flow_grants (flow_id, principal_type, principal_id, role, created_by)
         VALUES ($1, $2, $3, 'owner', $4)`,
        [flowId, principalType, principalId, args.createdByUserId],
      );

      const finalFlow = await client.query("SELECT * FROM jm_flows WHERE id = $1", [flowId]);
      await client.query("COMMIT");

      const base = rowToFlowBase(finalFlow.rows[0]);
      const owner = await this.grants.getOwnerGrant(flowId);
      const orgHint = args.scope === "user" ? args.orgId : null;
      return {
        flow: hydrateFromOwnerGrant(base, owner, orgHint),
        version: rowToVersion(verRes.rows[0]),
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getById(flowId: string): Promise<Flow | null> {
    const { rows } = await this.pool.query("SELECT * FROM jm_flows WHERE id = $1", [flowId]);
    if (!rows[0]) return null;
    const base = rowToFlowBase(rows[0]);
    const owner = await this.grants.getOwnerGrant(flowId);
    const orgHint = await this.resolveUserPrimaryOrgId(owner);
    const flow = hydrateFromOwnerGrant(base, owner, orgHint);
    flow.grants = await this.grants.listByFlow(flowId);
    return flow;
  }

  async list(filter: FlowListFilter): Promise<Flow[]> {
    // Build the visibility predicate per the permission model.
    // - platform admin: everything (with optional scope/orgId narrowing).
    // - else: any flow the caller has a matching grant on, plus
    //         (if caller is org admin of filter.orgId or callerOrgId)
    //         user-scope flows whose owner is a member of that org.
    const params: any[] = [];
    const push = (v: any) => { params.push(v); return `$${params.length}`; };

    const conds: string[] = [];

    if (filter.callerIsPlatformAdmin) {
      // No grant predicate; all rows visible.
    } else {
      const userP = push(filter.callerUserId);
      const orgP  = push(filter.callerOrgId);
      const orClauses: string[] = [
        `EXISTS (SELECT 1 FROM jm_flow_grants g WHERE g.flow_id = f.id AND g.principal_type = 'global')`,
        `EXISTS (SELECT 1 FROM jm_flow_grants g WHERE g.flow_id = f.id AND g.principal_type = 'user' AND g.principal_id = ${userP})`,
        `EXISTS (SELECT 1 FROM jm_flow_grants g WHERE g.flow_id = f.id AND g.principal_type = 'org'  AND g.principal_id = ${orgP})`,
      ];
      if (filter.callerIsOrgAdmin && filter.callerOrgId) {
        // Org admin sees user-scope flows owned by members of their org.
        orClauses.push(
          `EXISTS (
             SELECT 1 FROM jm_flow_grants g
             JOIN jm_memberships m ON m.user_id = g.principal_id AND m.org_id = ${orgP}
             WHERE g.flow_id = f.id AND g.principal_type = 'user' AND g.role = 'owner'
           )`,
        );
      }
      conds.push(`(${orClauses.join(" OR ")})`);
    }

    // Scope/orgId narrowing.
    if (filter.scope) {
      const sp = push(filter.scope);
      conds.push(`EXISTS (SELECT 1 FROM jm_flow_grants g WHERE g.flow_id = f.id AND g.role = 'owner' AND g.principal_type = ${sp})`);
    }
    if (filter.orgId) {
      const op = push(filter.orgId);
      conds.push(`EXISTS (
        SELECT 1 FROM jm_flow_grants g
        WHERE g.flow_id = f.id AND g.role = 'owner' AND (
          g.principal_type = 'org' AND g.principal_id = ${op}
          OR g.principal_type = 'user' AND EXISTS (
            SELECT 1 FROM jm_memberships m WHERE m.user_id = g.principal_id AND m.org_id = ${op}
          )
        )
      )`);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const limit = filter.limit ? `LIMIT ${Number(filter.limit)}` : "LIMIT 200";
    const sql = `SELECT f.* FROM jm_flows f ${where} ORDER BY f.created_at DESC ${limit}`;
    const { rows } = await this.pool.query(sql, params);

    // Hydrate each flow's owner grant. N+1 acceptable for now (small lists).
    const out: Flow[] = [];
    for (const r of rows) {
      const base = rowToFlowBase(r);
      const owner = await this.grants.getOwnerGrant(r.id);
      const orgHint = await this.resolveUserPrimaryOrgId(owner);
      out.push(hydrateFromOwnerGrant(base, owner, orgHint));
    }
    return out;
  }

  async updateMeta(flowId: string, patch: { name?: string; description?: string | null }): Promise<Flow | null> {
    const sets: string[] = [];
    const params: any[] = [];
    const push = (v: any) => { params.push(v); return `$${params.length}`; };
    if (patch.name !== undefined)        sets.push(`name = ${push(patch.name)}`);
    if (patch.description !== undefined) sets.push(`description = ${push(patch.description)}`);
    if (sets.length === 0) return this.getById(flowId);
    sets.push("updated_at = now()");
    params.push(flowId);
    await this.pool.query(`UPDATE jm_flows SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    return this.getById(flowId);
  }

  async delete(flowId: string): Promise<void> {
    await this.pool.query("DELETE FROM jm_flows WHERE id = $1", [flowId]);
  }

  /** When the owner grant is a user grant, look up that user's primary org. Used purely as a UI hint. */
  private async resolveUserPrimaryOrgId(owner: FlowGrant | null): Promise<string | null> {
    if (!owner || owner.principalType !== "user" || !owner.principalId) return null;
    const r = await this.pool.query(
      "SELECT org_id FROM jm_memberships WHERE user_id = $1 ORDER BY created_at LIMIT 1",
      [owner.principalId],
    );
    return r.rows[0]?.org_id ?? null;
  }
}
