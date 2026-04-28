import type { Pool } from "pg";
import type { SecretRecord } from "@journeyman/core";
import { open, seal } from "./crypto.ts";

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

export function validateName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`Invalid secret name: ${name}`);
}

function rowToRecord(r: any): SecretRecord {
  return {
    id: r.id, orgId: r.org_id, userId: r.user_id,
    name: r.name, description: r.description,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export class DuplicateSecretError extends Error {
  constructor(name: string) { super(`Secret already exists: ${name}`); this.name = "DuplicateSecretError"; }
}

export interface InsertInput {
  orgId: string;
  userId: string | null;
  name: string;
  value: string;
  description?: string | null;
  createdBy: string;
}

async function insertSecret(pool: Pool, input: InsertInput): Promise<SecretRecord> {
  validateName(input.name);
  const sealed = seal(input.value);
  try {
    const r = await pool.query(
      `INSERT INTO jm_secrets (org_id, user_id, name, description, ciphertext, iv, auth_tag, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, org_id, user_id, name, description, created_by, created_at, updated_at`,
      [input.orgId, input.userId, input.name, input.description ?? null,
       sealed.ciphertext, sealed.iv, sealed.authTag, input.createdBy],
    );
    return rowToRecord(r.rows[0]);
  } catch (err: any) {
    if (err.code === "23505") throw new DuplicateSecretError(input.name);
    throw err;
  }
}

// --- Org-scope ---

export function insertOrgSecret(pool: Pool, input: Omit<InsertInput, "userId">): Promise<SecretRecord> {
  return insertSecret(pool, { ...input, userId: null });
}

export async function listOrgSecrets(pool: Pool, orgId: string): Promise<SecretRecord[]> {
  const r = await pool.query(
    `SELECT id, org_id, user_id, name, description, created_by, created_at, updated_at
       FROM jm_secrets WHERE org_id = $1 AND user_id IS NULL ORDER BY name`,
    [orgId],
  );
  return r.rows.map(rowToRecord);
}

// --- User-scope ---

export function insertUserSecret(pool: Pool, input: InsertInput & { userId: string }): Promise<SecretRecord> {
  return insertSecret(pool, input);
}

export async function listUserSecrets(pool: Pool, orgId: string, userId: string): Promise<SecretRecord[]> {
  const r = await pool.query(
    `SELECT id, org_id, user_id, name, description, created_by, created_at, updated_at
       FROM jm_secrets WHERE org_id = $1 AND user_id = $2 ORDER BY name`,
    [orgId, userId],
  );
  return r.rows.map(rowToRecord);
}

// --- Updates / deletes ---

export interface UpdateInput {
  id: string;
  orgId: string;
  userId: string | null;
  value?: string;
  description?: string | null;
}

export async function updateSecret(pool: Pool, input: UpdateInput): Promise<boolean> {
  const sets: string[] = [];
  const params: any[] = [input.id, input.orgId];
  const userClause = input.userId === null ? "AND user_id IS NULL" : "AND user_id = $3";
  if (input.userId !== null) params.push(input.userId);

  if (input.value !== undefined) {
    const sealed = seal(input.value);
    sets.push(`ciphertext = $${params.length + 1}`); params.push(sealed.ciphertext);
    sets.push(`iv = $${params.length + 1}`);          params.push(sealed.iv);
    sets.push(`auth_tag = $${params.length + 1}`);    params.push(sealed.authTag);
  }
  if (input.description !== undefined) {
    sets.push(`description = $${params.length + 1}`); params.push(input.description);
  }
  if (sets.length === 0) return true;
  sets.push(`updated_at = now()`);

  const r = await pool.query(
    `UPDATE jm_secrets SET ${sets.join(", ")}
      WHERE id = $1 AND org_id = $2 ${userClause}`,
    params,
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteSecret(
  pool: Pool, id: string, orgId: string, userId: string | null,
): Promise<boolean> {
  const userClause = userId === null ? "AND user_id IS NULL" : "AND user_id = $3";
  const params: any[] = userId === null ? [id, orgId] : [id, orgId, userId];
  const r = await pool.query(
    `DELETE FROM jm_secrets WHERE id = $1 AND org_id = $2 ${userClause}`,
    params,
  );
  return (r.rowCount ?? 0) > 0;
}

// --- Resolver helper ---

export interface ResolverRow { name: string; userId: string | null; value: string; }

export async function fetchForResolve(
  pool: Pool, orgId: string, userId: string, names: string[],
): Promise<ResolverRow[]> {
  if (names.length === 0) return [];
  const r = await pool.query(
    `SELECT name, user_id, ciphertext, iv, auth_tag
       FROM jm_secrets
      WHERE org_id = $1
        AND name = ANY($2::text[])
        AND (user_id = $3 OR user_id IS NULL)`,
    [orgId, names, userId],
  );
  return r.rows.map((row: any) => ({
    name: row.name,
    userId: row.user_id,
    value: open({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }),
  }));
}
