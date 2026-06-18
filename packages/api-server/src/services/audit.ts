import type { Pool } from "pg";
import { createLogger } from "@journeyman/core";

const log = createLogger("audit");

export interface AuditEntryInput {
  orgId: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  detail?: Record<string, unknown>;
}

export interface AuditEntry {
  id: string;
  org_id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

/**
 * Append an audit entry. Never throws — an audit failure must not break the
 * action being audited. Also emits a structured log line for ops pipelines.
 */
export async function audit(pool: Pool, e: AuditEntryInput): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO jm_audit_log (org_id, actor_user_id, action, target_type, target_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [e.orgId, e.actorUserId, e.action, e.targetType, e.targetId ?? null, JSON.stringify(e.detail ?? {})],
    );
    log.info(
      { orgId: e.orgId, actorUserId: e.actorUserId, action: e.action, targetType: e.targetType, targetId: e.targetId ?? null },
      "audit",
    );
  } catch (err) {
    log.error({ err, action: e.action }, "audit insert failed");
  }
}

export async function listAudit(
  pool: Pool,
  orgId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const params: unknown[] = [orgId];
  let where = `org_id = $1`;
  if (opts.before) {
    params.push(opts.before);
    where += ` AND created_at < $${params.length}`;
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT * FROM jm_audit_log WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows as AuditEntry[];
}
