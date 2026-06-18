import type { Pool } from "pg";
import type { Connection, ConnectionCategory, ConnectionScope } from "@journeyman/core";

export class DuplicateConnectionError extends Error {
  constructor(label: string) {
    super(`connection "${label}" already exists`);
    this.name = "DuplicateConnectionError";
  }
}

/** Opaque sealed credential (AES-256-GCM parts), produced/consumed by the caller's crypto. */
export interface SealedCredential {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function rowToConnection(r: any): Connection {
  return {
    id: r.id,
    scope: r.scope,
    userId: r.user_id ?? undefined,
    orgId: r.org_id,
    category: r.category,
    provider: r.provider,
    label: r.label,
    baseUrl: r.base_url ?? undefined,
    config: r.config ?? {},
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface InsertConnectionInput {
  scope: ConnectionScope;
  userId: string | null;
  orgId: string;
  category: ConnectionCategory;
  provider: string;
  label: string;
  baseUrl?: string;
  credential: SealedCredential;
  config?: Record<string, unknown>;
  createdBy: string;
}

export async function insertConnection(pool: Pool, input: InsertConnectionInput): Promise<Connection> {
  try {
    const { rows } = await pool.query(
      `INSERT INTO jm_connections
         (scope, user_id, org_id, category, provider, label, base_url, cred_ciphertext, cred_iv, cred_auth_tag, config, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        input.scope,
        input.userId,
        input.orgId,
        input.category,
        input.provider,
        input.label,
        input.baseUrl ?? null,
        input.credential.ciphertext,
        input.credential.iv,
        input.credential.authTag,
        input.config ?? {},
        input.createdBy,
      ],
    );
    return rowToConnection(rows[0]);
  } catch (err: any) {
    if (err.code === "23505") throw new DuplicateConnectionError(input.label);
    throw err;
  }
}

export async function getConnection(pool: Pool, id: string): Promise<Connection | null> {
  const { rows } = await pool.query(`SELECT * FROM jm_connections WHERE id = $1`, [id]);
  return rows[0] ? rowToConnection(rows[0]) : null;
}

/** Fetch the sealed credential parts for a connection (caller decrypts). */
export async function getConnectionSealed(pool: Pool, id: string): Promise<SealedCredential | null> {
  const { rows } = await pool.query(
    `SELECT cred_ciphertext, cred_iv, cred_auth_tag FROM jm_connections WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  return { ciphertext: rows[0].cred_ciphertext, iv: rows[0].cred_iv, authTag: rows[0].cred_auth_tag };
}

export async function listConnections(
  pool: Pool,
  orgId: string,
  userId: string | null,
  category?: ConnectionCategory,
): Promise<Connection[]> {
  const params: unknown[] = [orgId, userId];
  let sql = `SELECT * FROM jm_connections
             WHERE org_id = $1 AND COALESCE(user_id::text, '') = COALESCE($2::text, '')`;
  if (category) {
    params.push(category);
    sql += ` AND category = $3`;
  }
  sql += ` ORDER BY label ASC`;
  const { rows } = await pool.query(sql, params);
  return rows.map(rowToConnection);
}

export async function updateConnection(
  pool: Pool,
  id: string,
  patch: { label?: string; baseUrl?: string; config?: Record<string, unknown>; credential?: SealedCredential },
): Promise<Connection | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };
  if (patch.label !== undefined) push("label", patch.label);
  if (patch.baseUrl !== undefined) push("base_url", patch.baseUrl);
  if (patch.config !== undefined) push("config", patch.config);
  if (patch.credential) {
    push("cred_ciphertext", patch.credential.ciphertext);
    push("cred_iv", patch.credential.iv);
    push("cred_auth_tag", patch.credential.authTag);
  }
  if (sets.length === 0) return getConnection(pool, id);
  sets.push(`updated_at = now()`);
  vals.push(id);
  try {
    const { rows } = await pool.query(
      `UPDATE jm_connections SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
      vals,
    );
    return rows[0] ? rowToConnection(rows[0]) : null;
  } catch (err: any) {
    if (err.code === "23505") throw new DuplicateConnectionError(patch.label ?? "");
    throw err;
  }
}

export async function deleteConnection(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM jm_connections WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Delete-in-use guard (spec §7.5): returns the names of agents that reference this
 * connection (via a repoSelections[].connectionId or notifications.connectionId).
 */
export async function agentsUsingConnection(pool: Pool, connectionId: string): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT name FROM jm_agents
      WHERE definition->'repoSelections' @> $1::jsonb
         OR definition->'notifications'->>'connectionId' = $2
      ORDER BY name ASC`,
    [JSON.stringify([{ connectionId }]), connectionId],
  );
  return rows.map((r) => r.name as string);
}
