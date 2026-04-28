import type { Pool } from "pg";
import type { MembershipRecord, OrgRecord, Role, UserRecord } from "@journeyman/core";

function rowToUser(r: any): UserRecord {
  return {
    id: r.id, username: r.username, displayName: r.display_name,
    status: r.status,
    isPlatformAdmin: !!r.is_platform_admin,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function rowToOrg(r: any): OrgRecord {
  return { id: r.id, slug: r.slug, name: r.name, createdAt: r.created_at };
}
function rowToMembership(r: any): MembershipRecord {
  return {
    id: r.id, userId: r.user_id, orgId: r.org_id,
    role: r.role as Role, createdAt: r.created_at,
  };
}

export async function findUserByUsername(pool: Pool, username: string) {
  const r = await pool.query(
    `SELECT u.*, ai.secret_hash
       FROM jm_users u
       JOIN jm_auth_identities ai
         ON ai.user_id = u.id AND ai.provider = 'password'
      WHERE u.username = $1 AND u.status = 'active'`,
    [username],
  );
  if (!r.rows[0]) return null;
  return { user: rowToUser(r.rows[0]), passwordHash: r.rows[0].secret_hash as string };
}

export async function getUser(pool: Pool, userId: string): Promise<UserRecord | null> {
  const r = await pool.query("SELECT * FROM jm_users WHERE id = $1", [userId]);
  return r.rows[0] ? rowToUser(r.rows[0]) : null;
}

export async function getOrg(pool: Pool, orgId: string): Promise<OrgRecord | null> {
  const r = await pool.query("SELECT * FROM jm_orgs WHERE id = $1", [orgId]);
  return r.rows[0] ? rowToOrg(r.rows[0]) : null;
}

export async function findMembership(
  pool: Pool, userId: string, orgId: string,
): Promise<MembershipRecord | null> {
  const r = await pool.query(
    "SELECT * FROM jm_memberships WHERE user_id = $1 AND org_id = $2",
    [userId, orgId],
  );
  return r.rows[0] ? rowToMembership(r.rows[0]) : null;
}

export async function listMembershipsForUser(pool: Pool, userId: string) {
  const r = await pool.query(
    `SELECT m.*, o.slug AS org_slug, o.name AS org_name
       FROM jm_memberships m JOIN jm_orgs o ON o.id = m.org_id
      WHERE m.user_id = $1`,
    [userId],
  );
  return r.rows.map((row: any) => ({
    membership: rowToMembership(row),
    org: { id: row.org_id, slug: row.org_slug, name: row.org_name } as Pick<OrgRecord, "id"|"slug"|"name">,
  }));
}

export async function listMembershipsForOrg(pool: Pool, orgId: string) {
  const r = await pool.query(
    `SELECT m.*, u.username, u.display_name
       FROM jm_memberships m JOIN jm_users u ON u.id = m.user_id
      WHERE m.org_id = $1`,
    [orgId],
  );
  return r.rows.map((row: any) => ({
    membership: rowToMembership(row),
    user: { id: row.user_id, username: row.username, displayName: row.display_name },
  }));
}

export async function insertRefreshToken(
  pool: Pool, input: { userId: string; tokenHash: string; activeOrgId: string; expiresAt: Date },
) {
  await pool.query(
    `INSERT INTO jm_refresh_tokens (user_id, token_hash, active_org_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [input.userId, input.tokenHash, input.activeOrgId, input.expiresAt],
  );
}

export async function findActiveRefreshToken(pool: Pool, tokenHash: string) {
  const r = await pool.query(
    `SELECT * FROM jm_refresh_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [tokenHash],
  );
  return r.rows[0] ?? null;
}

export async function revokeRefreshToken(pool: Pool, tokenHash: string) {
  await pool.query(
    "UPDATE jm_refresh_tokens SET revoked_at = now() WHERE token_hash = $1",
    [tokenHash],
  );
}

export async function findActiveApiToken(pool: Pool, tokenHash: string) {
  const r = await pool.query(
    `SELECT * FROM jm_api_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())`,
    [tokenHash],
  );
  return r.rows[0] ?? null;
}

export async function touchApiTokenLastUsed(pool: Pool, id: string) {
  await pool.query("UPDATE jm_api_tokens SET last_used_at = now() WHERE id = $1", [id]);
}

export async function insertApiToken(
  pool: Pool,
  input: { userId: string; orgId: string; name: string; tokenHash: string; expiresAt: Date | null },
) {
  const r = await pool.query(
    `INSERT INTO jm_api_tokens (user_id, org_id, name, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, created_at, expires_at, last_used_at`,
    [input.userId, input.orgId, input.name, input.tokenHash, input.expiresAt],
  );
  return r.rows[0];
}

export async function listApiTokens(pool: Pool, orgId: string, userId: string | null) {
  const sql = userId
    ? `SELECT id, name, last_used_at, expires_at, created_at, revoked_at
         FROM jm_api_tokens WHERE org_id = $1 AND user_id = $2 ORDER BY created_at DESC`
    : `SELECT id, name, last_used_at, expires_at, created_at, revoked_at
         FROM jm_api_tokens WHERE org_id = $1 ORDER BY created_at DESC`;
  const params = userId ? [orgId, userId] : [orgId];
  const r = await pool.query(sql, params);
  return r.rows;
}

export async function revokeApiToken(pool: Pool, id: string, orgId: string) {
  await pool.query(
    "UPDATE jm_api_tokens SET revoked_at = now() WHERE id = $1 AND org_id = $2",
    [id, orgId],
  );
}

export async function createInvite(
  pool: Pool,
  input: { orgId: string; username: string; role: Role; passwordHash: string; displayName?: string },
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let userRow = (await client.query("SELECT * FROM jm_users WHERE username = $1", [input.username])).rows[0];
    if (!userRow) {
      userRow = (await client.query(
        `INSERT INTO jm_users (username, display_name)
         VALUES ($1, $2) RETURNING *`,
        [input.username, input.displayName ?? null],
      )).rows[0];
      await client.query(
        `INSERT INTO jm_auth_identities (user_id, provider, subject, secret_hash)
         VALUES ($1, 'password', $2, $3)`,
        [userRow.id, input.username, input.passwordHash],
      );
    }
    await client.query(
      `INSERT INTO jm_memberships (user_id, org_id, role)
       VALUES ($1, $2, $3) ON CONFLICT (user_id, org_id) DO NOTHING`,
      [userRow.id, input.orgId, input.role],
    );
    await client.query("COMMIT");
    return rowToUser(userRow);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function deleteMembership(pool: Pool, orgId: string, userId: string) {
  await pool.query(
    "DELETE FROM jm_memberships WHERE org_id = $1 AND user_id = $2",
    [orgId, userId],
  );
}

export async function updateMembershipRole(
  pool: Pool, orgId: string, userId: string, role: Role,
) {
  await pool.query(
    "UPDATE jm_memberships SET role = $1 WHERE org_id = $2 AND user_id = $3",
    [role, orgId, userId],
  );
}

export async function updateUserPassword(pool: Pool, userId: string, passwordHash: string) {
  await pool.query(
    `UPDATE jm_auth_identities SET secret_hash = $1
      WHERE user_id = $2 AND provider = 'password'`,
    [passwordHash, userId],
  );
}

export async function getUserPasswordHash(pool: Pool, userId: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT secret_hash FROM jm_auth_identities
      WHERE user_id = $1 AND provider = 'password'`,
    [userId],
  );
  return r.rows[0]?.secret_hash ?? null;
}

export async function updateUserProfile(pool: Pool, userId: string, displayName: string | null) {
  await pool.query(
    "UPDATE jm_users SET display_name = $1, updated_at = now() WHERE id = $2",
    [displayName, userId],
  );
}

export async function listUsersInOrg(pool: Pool, orgId: string) {
  const r = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.status, u.created_at, u.updated_at,
            m.id AS membership_id, m.role, m.created_at AS joined_at
       FROM jm_memberships m
       JOIN jm_users u ON u.id = m.user_id
      WHERE m.org_id = $1
      ORDER BY u.username`,
    [orgId],
  );
  return r.rows.map((row: any) => ({
    user: {
      id: row.id, username: row.username, displayName: row.display_name,
      status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
    },
    membership: {
      id: row.membership_id, userId: row.id, orgId,
      role: row.role, createdAt: row.joined_at,
    },
  }));
}

export async function setUserStatus(
  pool: Pool, userId: string, status: "active" | "disabled",
) {
  await pool.query(
    "UPDATE jm_users SET status = $1, updated_at = now() WHERE id = $2",
    [status, userId],
  );
}

export async function countActiveAdminsInOrg(pool: Pool, orgId: string): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM jm_memberships m JOIN jm_users u ON u.id = m.user_id
      WHERE m.org_id = $1 AND m.role = 'admin' AND u.status = 'active'`,
    [orgId],
  );
  return r.rows[0].n;
}

export async function isOrgAdmin(pool: Pool, orgId: string, userId: string): Promise<boolean> {
  const r = await pool.query(
    "SELECT 1 FROM jm_memberships WHERE org_id = $1 AND user_id = $2 AND role = 'admin'",
    [orgId, userId],
  );
  return r.rows.length > 0;
}

export async function adminUpdateUserProfile(
  pool: Pool, userId: string, displayName: string | null,
) {
  await pool.query(
    "UPDATE jm_users SET display_name = $1, updated_at = now() WHERE id = $2",
    [displayName, userId],
  );
}

export async function setUserPlatformAdmin(
  pool: Pool, userId: string, value: boolean,
): Promise<void> {
  await pool.query(
    "UPDATE jm_users SET is_platform_admin = $1, updated_at = now() WHERE id = $2",
    [value, userId],
  );
}

export async function countPlatformAdmins(pool: Pool): Promise<number> {
  const r = await pool.query(
    "SELECT COUNT(*)::int AS n FROM jm_users WHERE is_platform_admin = TRUE AND status = 'active'",
  );
  return r.rows[0].n;
}

export async function isUserPlatformAdmin(pool: Pool, userId: string): Promise<boolean> {
  const r = await pool.query(
    "SELECT is_platform_admin FROM jm_users WHERE id = $1", [userId],
  );
  return !!r.rows[0]?.is_platform_admin;
}
