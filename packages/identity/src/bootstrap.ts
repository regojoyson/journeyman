import bcrypt from "bcrypt";
import type { Pool } from "pg";
import { AlreadyBootstrappedError, type OrgRecord, type UserRecord } from "@journeyman/core";

export interface BootstrapInput {
  orgName: string;
  orgSlug: string;
  username: string;
  password: string;
  displayName?: string;
}

export async function bootstrap(
  pool: Pool,
  input: BootstrapInput,
): Promise<{ user: UserRecord; org: OrgRecord }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = await client.query(
      "SELECT bootstrapped_at FROM jm_system_state WHERE id = 1 FOR UPDATE",
    );
    if (state.rows[0]?.bootstrapped_at) {
      await client.query("ROLLBACK");
      throw new AlreadyBootstrappedError();
    }

    const orgRes = await client.query(
      "INSERT INTO jm_orgs (slug, name) VALUES ($1, $2) RETURNING id, slug, name, created_at",
      [input.orgSlug, input.orgName],
    );
    const userRes = await client.query(
      `INSERT INTO jm_users (username, display_name)
       VALUES ($1, $2)
       RETURNING id, username, display_name, status, created_at, updated_at`,
      [input.username, input.displayName ?? null],
    );
    const passwordHash = await bcrypt.hash(input.password, 12);
    await client.query(
      `INSERT INTO jm_auth_identities (user_id, provider, subject, secret_hash)
       VALUES ($1, 'password', $2, $3)`,
      [userRes.rows[0].id, input.username, passwordHash],
    );
    await client.query(
      "INSERT INTO jm_memberships (user_id, org_id, role) VALUES ($1, $2, 'admin')",
      [userRes.rows[0].id, orgRes.rows[0].id],
    );
    await client.query(
      "UPDATE jm_users SET is_platform_admin = TRUE WHERE id = $1",
      [userRes.rows[0].id],
    );
    const wsRes = await client.query(
      `INSERT INTO jm_workspaces (org_id, slug, name)
       VALUES ($1, 'default', 'Default')
       RETURNING id`,
      [orgRes.rows[0].id],
    );
    await client.query(
      `INSERT INTO jm_workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'maintainer')`,
      [wsRes.rows[0].id, userRes.rows[0].id],
    );
    await client.query(
      "UPDATE jm_system_state SET bootstrapped_at = now() WHERE id = 1",
    );
    await client.query("COMMIT");

    return {
      org: {
        id: orgRes.rows[0].id,
        slug: orgRes.rows[0].slug,
        name: orgRes.rows[0].name,
        createdAt: orgRes.rows[0].created_at,
      },
      user: {
        id: userRes.rows[0].id,
        username: userRes.rows[0].username,
        displayName: userRes.rows[0].display_name,
        status: userRes.rows[0].status,
        isPlatformAdmin: true,
        createdAt: userRes.rows[0].created_at,
        updatedAt: userRes.rows[0].updated_at,
      },
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function isBootstrapped(pool: Pool): Promise<boolean> {
  const r = await pool.query("SELECT bootstrapped_at FROM jm_system_state WHERE id = 1");
  return r.rows[0]?.bootstrapped_at != null;
}
