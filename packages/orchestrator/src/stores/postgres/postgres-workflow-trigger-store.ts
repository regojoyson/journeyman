import type { Pool } from "pg";
import type {
  IWorkflowTriggerStore,
  UpsertWorkflowTriggerArgs,
  WorkflowTriggerIndexRow,
  WorkflowTriggerKind,
} from "@journeyman/core";

function rowToIndex(r: Record<string, unknown>): WorkflowTriggerIndexRow {
  return {
    id: r.id as string,
    workflowId: r.workflow_id as string,
    workflowVersionId: r.workflow_version_id as string,
    triggerNodeId: r.trigger_node_id as string,
    kind: r.kind as WorkflowTriggerKind,
    webhookId: (r.webhook_id as string | null) ?? null,
    isActive: r.is_active as boolean,
    createdAt: r.created_at as Date,
  };
}

export class PostgresWorkflowTriggerStore implements IWorkflowTriggerStore {
  constructor(private pool: Pool) {}

  async replaceForVersion(workflowVersionId: string, rows: UpsertWorkflowTriggerArgs[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM jm_workflow_triggers WHERE workflow_version_id = $1`,
        [workflowVersionId],
      );
      for (const a of rows) {
        await client.query(
          `INSERT INTO jm_workflow_triggers
             (workflow_id, workflow_version_id, trigger_node_id, kind, webhook_id, is_active)
           VALUES ($1, $2, $3, $4, $5, false)`,
          [a.workflowId, a.workflowVersionId, a.triggerNodeId, a.kind, a.webhookId],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async setActiveForWorkflow(workflowId: string, workflowVersionId: string | null): Promise<void> {
    if (workflowVersionId === null) {
      await this.pool.query(
        `UPDATE jm_workflow_triggers SET is_active = false WHERE workflow_id = $1`,
        [workflowId],
      );
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE jm_workflow_triggers SET is_active = false WHERE workflow_id = $1`,
        [workflowId],
      );
      await client.query(
        `UPDATE jm_workflow_triggers SET is_active = true
         WHERE workflow_id = $1 AND workflow_version_id = $2`,
        [workflowId, workflowVersionId],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async findActiveWebhookTriggers(webhookId: string): Promise<WorkflowTriggerIndexRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_workflow_triggers
       WHERE is_active = true AND kind = 'webhook' AND webhook_id = $1`,
      [webhookId],
    );
    return rows.map(rowToIndex);
  }

  async listForWorkflow(workflowId: string): Promise<WorkflowTriggerIndexRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_workflow_triggers WHERE workflow_id = $1`,
      [workflowId],
    );
    return rows.map(rowToIndex);
  }
}
