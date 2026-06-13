import type {
  BuilderSessionRecord,
  CreateBuilderSessionInput,
  UpdateBuilderSessionInput,
} from "./types.ts";

/** Minimal structural seam over a pg Pool/Client so the store is unit-testable. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number }>;
}

const MAX_NAME_ATTEMPTS = 50;

function rowToRecord(r: any): BuilderSessionRecord {
  return {
    id: r.id,
    orgId: r.org_id,
    userId: r.user_id,
    name: r.name,
    status: r.status,
    messages: r.messages ?? [],
    buildPlan: r.build_plan ?? null,
    appliedFlowId: r.applied_flow_id ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function userClauseAndParams(
  prefix: unknown[],
  userId: string | null,
): { clause: string; params: unknown[] } {
  if (userId === null) return { clause: "AND user_id IS NULL", params: prefix };
  return { clause: `AND user_id = $${prefix.length + 1}`, params: [...prefix, userId] };
}

/**
 * Insert a session. On a unique-(org,user,name) collision, retry with a
 * " (N)" suffix rather than failing (the design's de-dup-on-collision rule).
 */
export async function insertBuilderSession(
  db: Queryable,
  input: CreateBuilderSessionInput,
): Promise<BuilderSessionRecord> {
  const messages = JSON.stringify(input.messages ?? []);
  const buildPlan = input.buildPlan == null ? null : JSON.stringify(input.buildPlan);
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
    const name = attempt === 1 ? input.name : `${input.name} (${attempt})`;
    try {
      const r = await db.query(
        `INSERT INTO jm_builder_sessions
           (org_id, user_id, name, messages, build_plan, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [input.orgId, input.userId, name, messages, buildPlan, input.createdBy],
      );
      return rowToRecord(r.rows[0]);
    } catch (err: any) {
      if (err?.code === "23505" && attempt < MAX_NAME_ATTEMPTS) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a unique builder session name");
}

export async function listBuilderSessions(
  db: Queryable,
  orgId: string,
  userId: string | null,
): Promise<BuilderSessionRecord[]> {
  const { clause, params } = userClauseAndParams([orgId], userId);
  const r = await db.query(
    `SELECT * FROM jm_builder_sessions WHERE org_id = $1 ${clause} ORDER BY updated_at DESC`,
    params,
  );
  return r.rows.map(rowToRecord);
}

export async function getBuilderSession(
  db: Queryable,
  id: string,
  orgId: string,
  userId: string | null,
): Promise<BuilderSessionRecord | null> {
  const { clause, params } = userClauseAndParams([id, orgId], userId);
  const r = await db.query(
    `SELECT * FROM jm_builder_sessions WHERE id = $1 AND org_id = $2 ${clause}`,
    params,
  );
  return r.rows[0] ? rowToRecord(r.rows[0]) : null;
}

export async function updateBuilderSession(
  db: Queryable,
  input: UpdateBuilderSessionInput,
): Promise<boolean> {
  const { clause, params: scopeParams } = userClauseAndParams([input.id, input.orgId], input.userId);
  const sets: string[] = [];
  const params: unknown[] = [...scopeParams];
  const push = (col: string, value: unknown) => {
    sets.push(`${col} = $${params.length + 1}`);
    params.push(value);
  };
  if (input.name !== undefined) push("name", input.name);
  if (input.status !== undefined) push("status", input.status);
  if (input.messages !== undefined) push("messages", JSON.stringify(input.messages));
  if (input.buildPlan !== undefined) push("build_plan", input.buildPlan == null ? null : JSON.stringify(input.buildPlan));
  if (input.appliedFlowId !== undefined) push("applied_flow_id", input.appliedFlowId);
  if (sets.length === 0) return true;
  sets.push("updated_at = now()");
  const r = await db.query(
    `UPDATE jm_builder_sessions SET ${sets.join(", ")}
      WHERE id = $1 AND org_id = $2 ${clause}
      RETURNING id`,
    params,
  );
  return r.rows.length > 0;
}

export async function deleteBuilderSession(
  db: Queryable,
  id: string,
  orgId: string,
  userId: string | null,
): Promise<boolean> {
  const { clause, params } = userClauseAndParams([id, orgId], userId);
  const r = await db.query(
    `DELETE FROM jm_builder_sessions WHERE id = $1 AND org_id = $2 ${clause} RETURNING id`,
    params,
  );
  return r.rows.length > 0;
}
