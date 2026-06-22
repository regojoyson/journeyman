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
    publishedVersionId: row.published_version_id,
    draftDefinition: row.draft_definition as WorkflowGraph,
    draftUpdatedAt: row.draft_updated_at ? new Date(row.draft_updated_at) : null,
    draftUpdatedByUserId: row.draft_updated_by_user_id,
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

  async create(args: CreateWorkflowArgs): Promise<Workflow> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_workflows
         (workspace_id, name, description, created_by_user_id,
          draft_definition, draft_updated_at, draft_updated_by_user_id)
       VALUES ($1, $2, $3, $4::uuid, $5::jsonb, now(), $4::text)
       RETURNING *`,
      [args.workspaceId, args.name, args.description ?? null, args.createdByUserId,
       JSON.stringify(args.initialDefinition)],
    );
    return rowToWorkflow(rows[0]);
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

  async updateDraft(
    workflowId: string,
    args: { definition: WorkflowGraph; updatedByUserId: string | null },
  ): Promise<Workflow | null> {
    const { rows } = await this.pool.query(
      `UPDATE jm_workflows
         SET draft_definition = $1::jsonb,
             draft_updated_at = now(),
             draft_updated_by_user_id = $2,
             updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [JSON.stringify(args.definition), args.updatedByUserId, workflowId],
    );
    return rows[0] ? rowToWorkflow(rows[0]) : null;
  }

  async promote(
    workflowId: string,
    args: { createdByUserId: string | null },
  ): Promise<{ workflow: Workflow; version: WorkflowVersion } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const wf = await client.query("SELECT draft_definition FROM jm_workflows WHERE id = $1 FOR UPDATE", [workflowId]);
      if (!wf.rows[0]) { await client.query("ROLLBACK"); return null; }
      const verRes = await client.query(
        `INSERT INTO jm_workflow_versions (workflow_id, version_number, definition, created_by_user_id)
         VALUES ($1,
                 COALESCE((SELECT MAX(version_number) + 1 FROM jm_workflow_versions WHERE workflow_id = $1), 1),
                 $2::jsonb, $3)
         RETURNING *`,
        [workflowId, JSON.stringify(wf.rows[0].draft_definition), args.createdByUserId],
      );
      const updated = await client.query(
        `UPDATE jm_workflows SET published_version_id = $1, status = 'ready', updated_at = now()
         WHERE id = $2 RETURNING *`,
        [verRes.rows[0].id, workflowId],
      );
      await client.query("COMMIT");
      return { workflow: rowToWorkflow(updated.rows[0]), version: rowToVersion(verRes.rows[0]) };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async rollback(workflowId: string, args: { versionId: string }): Promise<Workflow | null> {
    const { rows } = await this.pool.query(
      `UPDATE jm_workflows SET published_version_id = $1, status = 'ready', updated_at = now()
       WHERE id = $2
         AND EXISTS (SELECT 1 FROM jm_workflow_versions WHERE id = $1 AND workflow_id = $2)
       RETURNING *`,
      [args.versionId, workflowId],
    );
    return rows[0] ? rowToWorkflow(rows[0]) : null;
  }

  async setStatus(workflowId: string, status: WorkflowStatus): Promise<Workflow | null> {
    const clearPointer = status === "draft";
    const { rows } = await this.pool.query(
      `UPDATE jm_workflows
         SET status = $1,
             published_version_id = CASE WHEN $2 THEN NULL ELSE published_version_id END,
             updated_at = now()
       WHERE id = $3 RETURNING *`,
      [status, clearPointer, workflowId],
    );
    return rows[0] ? rowToWorkflow(rows[0]) : null;
  }

  async delete(workflowId: string): Promise<void> {
    await this.pool.query("DELETE FROM jm_workflows WHERE id = $1", [workflowId]);
  }
}
