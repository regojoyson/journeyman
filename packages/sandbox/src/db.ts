import type { CreateSandboxArgs, UpdateSandboxArgs, Sandbox } from "@journeyman/core";
import { rowToSandbox } from "./sandbox-record.ts";
import type { DockerConnection } from "./backends/docker/docker-client.ts";

/** Minimal structural seam over a pg Pool/Client so the store is unit-testable. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

const COLS =
  "id, scope, org_id, user_id, name, type, execution_mode, connectivity, config, tags, enabled, created_by, created_at, updated_at, image_state, image_fingerprint, image_ref, image_error, image_built_at";

export async function insertSandbox(db: Queryable, input: CreateSandboxArgs): Promise<Sandbox> {
  const { rows } = await db.query(
    `INSERT INTO jm_sandboxes
       (scope, org_id, user_id, name, type, execution_mode, connectivity, config, tags, enabled, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
     RETURNING ${COLS}`,
    [
      input.scope, input.orgId, input.userId, input.name, input.type, input.executionMode,
      input.connectivity ?? null, JSON.stringify(input.config ?? {}),
      JSON.stringify(input.tags ?? []), input.enabled ?? true, input.createdBy,
    ],
  );
  return rowToSandbox(rows[0]);
}

export async function listSandboxes(
  db: Queryable,
  scope: { orgId: string; userId: string | null },
): Promise<Sandbox[]> {
  if (scope.userId === null) {
    const { rows } = await db.query(
      `SELECT ${COLS} FROM jm_sandboxes WHERE org_id = $1 AND user_id IS NULL ORDER BY name`,
      [scope.orgId],
    );
    return rows.map(rowToSandbox);
  }
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_sandboxes WHERE org_id = $1 AND user_id = $2 ORDER BY name`,
    [scope.orgId, scope.userId],
  );
  return rows.map(rowToSandbox);
}

export async function getSandbox(
  db: Queryable,
  id: string,
  orgId: string,
  userId: string | null,
): Promise<Sandbox | null> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_sandboxes
     WHERE id = $1 AND org_id = $2 AND user_id IS NOT DISTINCT FROM $3`,
    [id, orgId, userId],
  );
  return rows[0] ? rowToSandbox(rows[0]) : null;
}

export async function updateSandbox(db: Queryable, input: UpdateSandboxArgs): Promise<boolean> {
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
  if (input.tags !== undefined) set("tags", JSON.stringify(input.tags), "::jsonb");
  if (input.enabled !== undefined) set("enabled", input.enabled);
  if (sets.length === 0) return true;
  sets.push("updated_at = now()");
  params.push(input.id, input.orgId, input.userId);
  const { rows } = await db.query(
    `UPDATE jm_sandboxes SET ${sets.join(", ")}
     WHERE id = $${i} AND org_id = $${i + 1} AND user_id IS NOT DISTINCT FROM $${i + 2}
     RETURNING id`,
    params,
  );
  return rows.length > 0;
}

export async function deleteSandbox(
  db: Queryable,
  id: string,
  orgId: string,
  userId: string | null,
): Promise<boolean> {
  const { rows } = await db.query(
    `DELETE FROM jm_sandboxes
     WHERE id = $1 AND org_id = $2 AND user_id IS NOT DISTINCT FROM $3
     RETURNING id`,
    [id, orgId, userId],
  );
  return rows.length > 0;
}

/** System defaults + this org's org-scoped + this user's user-scoped, enabled only. */
export async function listVisibleSandboxes(
  db: Queryable,
  orgId: string,
  userId: string,
): Promise<Sandbox[]> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_sandboxes
     WHERE enabled = true AND (
       scope = 'system'
       OR (scope = 'org'  AND org_id = $1)
       OR (scope = 'user' AND org_id = $1 AND user_id = $2)
     )
     ORDER BY scope, name`,
    [orgId, userId],
  );
  return rows.map(rowToSandbox);
}

/** Fetch a single worker visible to {orgId,userId} (system OR org OR user scope). */
export async function fetchSandboxById(
  db: Queryable,
  orgId: string,
  userId: string,
  id: string,
): Promise<Sandbox | null> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_sandboxes
     WHERE id = $1 AND enabled = true AND (
       scope = 'system'
       OR (scope = 'org'  AND org_id = $2)
       OR (scope = 'user' AND org_id = $2 AND user_id = $3)
     )`,
    [id, orgId, userId],
  );
  return rows[0] ? rowToSandbox(rows[0]) : null;
}


// ─────────────────────────────────────────────────────────────────────────────
// Managed-image build lifecycle (Spec B)
// ─────────────────────────────────────────────────────────────────────────────

/** Flip a target's image to 'pending' (recompute on next build loop tick). */
export async function markImagePending(db: Queryable, id: string): Promise<void> {
  await db.query(
    `UPDATE jm_sandboxes
        SET image_state = 'pending', image_error = NULL, updated_at = now()
      WHERE id = $1`,
    [id],
  );
}

/** Set a target back to 'none' (its image became empty → use the default box). */
export async function clearImageState(db: Queryable, id: string): Promise<void> {
  await db.query(
    `UPDATE jm_sandboxes
        SET image_state = 'none', image_fingerprint = NULL, image_ref = NULL,
            image_error = NULL, image_built_at = NULL, updated_at = now()
      WHERE id = $1`,
    [id],
  );
}

/**
 * Atomically claim one buildable target: state='pending', OR state='building'
 * with an expired lease (crash recovery). Leases it to `owner` for `leaseMs`.
 */
export async function claimPendingBuild(
  db: Queryable, owner: string, leaseMs: number,
): Promise<Sandbox | null> {
  const { rows } = await db.query(
    `UPDATE jm_sandboxes
        SET image_state = 'building', build_owner = $1,
            build_lease_until = now() + ($2::bigint * interval '1 millisecond'),
            updated_at = now()
      WHERE id = (
        SELECT id FROM jm_sandboxes
         WHERE type = 'docker' AND enabled = true AND (
                 image_state = 'pending'
              OR (image_state = 'building' AND (build_lease_until IS NULL OR build_lease_until < now()))
         )
         ORDER BY updated_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING ${COLS}`,
    [owner, leaseMs],
  );
  return rows[0] ? rowToSandbox(rows[0]) : null;
}

/** Extend a held lease (heartbeat during a long build). */
export async function renewBuildLease(
  db: Queryable, id: string, owner: string, leaseMs: number,
): Promise<void> {
  await db.query(
    `UPDATE jm_sandboxes
        SET build_lease_until = now() + ($3::bigint * interval '1 millisecond')
      WHERE id = $1 AND build_owner = $2 AND image_state = 'building'`,
    [id, owner, leaseMs],
  );
}

/** Commit a successful build (sets the fingerprint that was built). */
export async function commitBuildResult(
  db: Queryable, id: string, fingerprint: string, imageRef: string,
): Promise<void> {
  await db.query(
    `UPDATE jm_sandboxes
        SET image_state = 'ready', image_fingerprint = $2, image_ref = $3,
            image_error = NULL, image_built_at = now(),
            build_owner = NULL, build_lease_until = NULL, updated_at = now()
      WHERE id = $1`,
    [id, fingerprint, imageRef],
  );
}

/** Record a build failure with the captured log. */
export async function failBuild(
  db: Queryable, id: string, fingerprint: string, error: string,
): Promise<void> {
  await db.query(
    `UPDATE jm_sandboxes
        SET image_state = 'failed', image_fingerprint = $2, image_error = $3,
            build_owner = NULL, build_lease_until = NULL, updated_at = now()
      WHERE id = $1`,
    [id, fingerprint, error],
  );
}

/** Image refs of all docker sandboxes whose managed image is currently `ready`. */
export async function listReadyImageRefs(db: Queryable): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT image_ref FROM jm_sandboxes
      WHERE type = 'docker' AND image_state = 'ready' AND image_ref IS NOT NULL`,
  );
  return rows.map((r) => r.image_ref as string);
}

/** Distinct daemons where docker-sandbox images are built (for the prune sweep). */
export async function listDockerSandboxConnections(db: Queryable): Promise<DockerConnection[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT config->'connection' AS connection
       FROM jm_sandboxes
      WHERE type = 'docker' AND config->'connection' IS NOT NULL`,
  );
  return rows
    .map((r) => r.connection as DockerConnection | null)
    .filter((c): c is DockerConnection => !!c?.host);
}

/** After create/update of a target, sync its image lifecycle state from config. */
export async function applyImageStateOnSave(
  db: Queryable, id: string, type: string, config: Record<string, unknown>,
): Promise<void> {
  if (type !== "docker") return;
  const img = config["image"] as { kind?: string; imageRef?: string; content?: string } | undefined;
  const hasRecipe =
    (img?.kind === "ref" && !!img.imageRef?.trim()) ||
    (img?.kind === "dockerfile" && !!img.content?.trim());
  if (hasRecipe) await markImagePending(db, id);
  else await clearImageState(db, id);
}
