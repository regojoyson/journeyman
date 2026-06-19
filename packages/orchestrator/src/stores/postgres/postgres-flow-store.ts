import type { Pool } from "pg";
import type {
  CreateWorkflowArgs, Workflow, WorkflowGraph, WorkflowListFilter,
  WorkflowStatus, WorkflowVersion,
  IWorkflowStore, IWorkflowVersionStore,
} from "@journeyman/core";

function rowToWorkflow(row: any): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    currentVersionId: row.current_version_id,
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    status: row.status as WorkflowStatus,
    workspaceId: row.workspace_id,
  };
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
  ) {}

  async create(args: CreateWorkflowArgs): Promise<{ workflow: Workflow; version: WorkflowVersion }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      const workflowRes = await client.query(
        `INSERT INTO jm_workflows (workspace_id, name, description, created_by_user_id)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [args.workspaceId, args.name, args.description ?? null, args.createdByUserId],
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

      const finalWorkflow = await client.query("SELECT * FROM jm_workflows WHERE id = $1", [workflowId]);
      await client.query("COMMIT");

      return {
        workflow: rowToWorkflow(finalWorkflow.rows[0]),
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
    return rows[0] ? rowToWorkflow(rows[0]) : null;
  }

  async list(filter: WorkflowListFilter): Promise<Workflow[]> {
    const limit = filter.limit ? `LIMIT ${Number(filter.limit)}` : "LIMIT 200";
    const offset = filter.offset ? `OFFSET ${Number(filter.offset)}` : "";
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_workflows WHERE workspace_id = $1 ORDER BY created_at DESC ${limit} ${offset}`,
      [filter.workspaceId],
    );
    return rows.map(rowToWorkflow);
  }

  async count(filter: Omit<WorkflowListFilter, "limit" | "offset">): Promise<number> {
    const { rows } = await this.pool.query(
      "SELECT COUNT(*)::int AS n FROM jm_workflows WHERE workspace_id = $1",
      [filter.workspaceId],
    );
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
}
