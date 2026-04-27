import type { Pool } from "pg";
import type {
  CreateFlowArgs, Flow, FlowGraph, FlowVersion,
  IFlowStore, IFlowVersionStore,
} from "@journeyman/core";

function rowToFlow(row: any): Flow {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    currentVersionId: row.current_version_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
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
  constructor(private pool: Pool, private versions: PostgresFlowVersionStore) {}

  async create(args: CreateFlowArgs): Promise<{ flow: Flow; version: FlowVersion }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      const flowRes = await client.query(
        `INSERT INTO jm_flows (owner_user_id, name, description)
         VALUES ($1, $2, $3) RETURNING *`,
        [args.ownerUserId, args.name, args.description ?? null],
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
      const finalFlow = await client.query("SELECT * FROM jm_flows WHERE id = $1", [flowId]);
      await client.query("COMMIT");
      return {
        flow: rowToFlow(finalFlow.rows[0]),
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
    return rows[0] ? rowToFlow(rows[0]) : null;
  }

  async list(opts: { ownerUserId?: string | null; limit?: number } = {}): Promise<Flow[]> {
    const params: any[] = [];
    let where = "";
    if (opts.ownerUserId === null) {
      where = "WHERE owner_user_id IS NULL";
    } else if (opts.ownerUserId !== undefined) {
      params.push(opts.ownerUserId);
      where = "WHERE owner_user_id = $1";
    }
    const limit = opts.limit ? `LIMIT ${Number(opts.limit)}` : "";
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_flows ${where} ORDER BY created_at DESC ${limit}`, params,
    );
    return rows.map(rowToFlow);
  }
}
