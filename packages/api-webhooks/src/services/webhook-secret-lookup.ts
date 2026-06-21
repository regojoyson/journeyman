import type { Pool } from "pg";
import type { WebhookAuthConfig } from "@journeyman/core";
import { open, readGlobalSecrets } from "@journeyman/secrets";

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Resolve a named secret for a webhook. Cascades: workspace secret first,
 * then org secret. Returns null if the name is empty/invalid or no row found.
 */
export async function resolveWebhookSecret(
  pool: Pool,
  orgId: string,
  secretName: string | undefined | null,
  workspaceId?: string | null,
): Promise<string | null> {
  if (!secretName) return null;
  if (!NAME_RE.test(secretName)) return null;

  if (workspaceId) {
    const r = await pool.query(
      `SELECT ciphertext, iv, auth_tag FROM jm_secrets WHERE workspace_id = $1 AND name = $2`,
      [workspaceId, secretName],
    );
    if (r.rows[0]) {
      const row = r.rows[0];
      return open({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
    }
  }

  const r = await pool.query(
    `SELECT ciphertext, iv, auth_tag FROM jm_secrets WHERE org_id = $1 AND workspace_id IS NULL AND name = $2`,
    [orgId, secretName],
  );
  const row = r.rows[0];
  if (!row) return null;
  return open({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
}

/**
 * Read the appropriate secret reference field from an auth config.
 * Returns null when the mode doesn't have a secret (none) or the ref is empty.
 */
export function secretRefFromAuth(auth: WebhookAuthConfig): string | null {
  switch (auth.mode) {
    case "none": return null;
    case "header-equals": return auth.valueRef || null;
    case "hmac": return auth.secretRef || null;
    case "jwt": return auth.signingKeyRef || null;
  }
}

/**
 * Returns true if a secret with the given name resolves in either org or
 * global scope. Used by promote-to-org to pre-validate that an org-scope
 * webhook will be able to read its referenced secret at ingest time.
 */
export async function secretExistsInOrgScope(
  pool: Pool,
  orgId: string,
  name: string,
): Promise<boolean> {
  if (!name) return false;
  const globals = readGlobalSecrets();
  if (name in globals) return true;
  const r = await pool.query(
    `SELECT 1 FROM jm_secrets WHERE org_id = $1 AND workspace_id IS NULL AND name = $2 LIMIT 1`,
    [orgId, name],
  );
  return r.rowCount !== null && r.rowCount > 0;
}
