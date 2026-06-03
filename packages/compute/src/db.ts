import type { CreateComputeTargetArgs, UpdateComputeTargetArgs, ComputeTarget } from "@journeyman/core";
import { rowToWorker } from "./worker-record.ts";

/** Minimal structural seam over a pg Pool/Client so the store is unit-testable. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

const COLS =
  "id, scope, org_id, user_id, name, type, execution_mode, connectivity, config, is_default, tags, enabled, created_by, created_at, updated_at";

export async function insertWorker(db: Queryable, input: CreateComputeTargetArgs): Promise<ComputeTarget> {
  const { rows } = await db.query(
    `INSERT INTO jm_workers
       (scope, org_id, user_id, name, type, execution_mode, connectivity, config, is_default, tags, enabled, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12)
     RETURNING ${COLS}`,
    [
      input.scope, input.orgId, input.userId, input.name, input.type, input.executionMode,
      input.connectivity ?? null, JSON.stringify(input.config ?? {}), input.isDefault ?? false,
      JSON.stringify(input.tags ?? []), input.enabled ?? true, input.createdBy,
    ],
  );
  return rowToWorker(rows[0]);
}

export async function listWorkers(
  db: Queryable,
  scope: { orgId: string; userId: string | null },
): Promise<ComputeTarget[]> {
  if (scope.userId === null) {
    const { rows } = await db.query(
      `SELECT ${COLS} FROM jm_workers WHERE org_id = $1 AND user_id IS NULL ORDER BY name`,
      [scope.orgId],
    );
    return rows.map(rowToWorker);
  }
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_workers WHERE org_id = $1 AND user_id = $2 ORDER BY name`,
    [scope.orgId, scope.userId],
  );
  return rows.map(rowToWorker);
}

export async function getWorker(
  db: Queryable,
  id: string,
  orgId: string,
  userId: string | null,
): Promise<ComputeTarget | null> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_workers
     WHERE id = $1 AND org_id = $2 AND user_id IS NOT DISTINCT FROM $3`,
    [id, orgId, userId],
  );
  return rows[0] ? rowToWorker(rows[0]) : null;
}

export async function updateWorker(db: Queryable, input: UpdateComputeTargetArgs): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const set = (col: string, val: unknown, cast = "") => {
    sets.push(`${col} = $${i}${cast}`);
    params.push(val);
    i += 1;
  };
  if (input.name !== undefined) set("name", input.name);
  if (input.executionMode !== undefined) set("execution_mode", input.executionMode);
  if (input.connectivity !== undefined) set("connectivity", input.connectivity);
  if (input.config !== undefined) set("config", JSON.stringify(input.config), "::jsonb");
  if (input.isDefault !== undefined) set("is_default", input.isDefault);
  if (input.tags !== undefined) set("tags", JSON.stringify(input.tags), "::jsonb");
  if (input.enabled !== undefined) set("enabled", input.enabled);
  if (sets.length === 0) return true;
  sets.push("updated_at = now()");
  params.push(input.id, input.orgId, input.userId);
  const { rows } = await db.query(
    `UPDATE jm_workers SET ${sets.join(", ")}
     WHERE id = $${i} AND org_id = $${i + 1} AND user_id IS NOT DISTINCT FROM $${i + 2}
     RETURNING id`,
    params,
  );
  return rows.length > 0;
}

export async function deleteWorker(
  db: Queryable,
  id: string,
  orgId: string,
  userId: string | null,
): Promise<boolean> {
  const { rows } = await db.query(
    `DELETE FROM jm_workers
     WHERE id = $1 AND org_id = $2 AND user_id IS NOT DISTINCT FROM $3
     RETURNING id`,
    [id, orgId, userId],
  );
  return rows.length > 0;
}

/** System defaults + this org's org-scoped + this user's user-scoped, enabled only. */
export async function listVisibleWorkers(
  db: Queryable,
  orgId: string,
  userId: string,
): Promise<ComputeTarget[]> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_workers
     WHERE enabled = true AND (
       scope = 'system'
       OR (scope = 'org'  AND org_id = $1)
       OR (scope = 'user' AND org_id = $1 AND user_id = $2)
     )
     ORDER BY scope, name`,
    [orgId, userId],
  );
  return rows.map(rowToWorker);
}

/** Fetch a single worker visible to {orgId,userId} (system OR org OR user scope). */
export async function fetchWorkerById(
  db: Queryable,
  orgId: string,
  userId: string,
  id: string,
): Promise<ComputeTarget | null> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_workers
     WHERE id = $1 AND enabled = true AND (
       scope = 'system'
       OR (scope = 'org'  AND org_id = $2)
       OR (scope = 'user' AND org_id = $2 AND user_id = $3)
     )`,
    [id, orgId, userId],
  );
  return rows[0] ? rowToWorker(rows[0]) : null;
}

/** The org/user's default worker, falling back to the system default. */
export async function fetchDefaultWorker(
  db: Queryable,
  orgId: string,
  userId: string,
): Promise<ComputeTarget | null> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_workers
     WHERE enabled = true AND is_default = true AND (
       scope = 'system'
       OR (scope = 'org'  AND org_id = $1)
       OR (scope = 'user' AND org_id = $1 AND user_id = $2)
     )
     ORDER BY CASE scope WHEN 'user' THEN 0 WHEN 'org' THEN 1 ELSE 2 END
     LIMIT 1`,
    [orgId, userId],
  );
  return rows[0] ? rowToWorker(rows[0]) : null;
}
