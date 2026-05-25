import type { Pool } from "pg";
import type { WebhookAuthConfig, WebhookScope } from "@journeyman/core";
import { open, readGlobalSecrets } from "@journeyman/secrets";

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Resolve a named secret for a webhook's scope. Returns null if the name is
 * empty/undefined/invalid, or no matching row is found. Decrypts the row's
 * ciphertext via the shared `open()` helper from @journeyman/secrets.
 *
 * Secret-name format: `^[A-Z][A-Z0-9_]*$`. Empty `valueRef`/`secretRef`/
 * `signingKeyRef` strings (preset defaults) short-circuit to null.
 */
export async function resolveWebhookSecret(
  pool: Pool,
  scope: WebhookScope,
  secretName: string | undefined | null,
): Promise<string | null> {
  if (!secretName) return null;
  if (!NAME_RE.test(secretName)) return null;

  if ("orgId" in scope) {
    const r = await pool.query(
      `SELECT ciphertext, iv, auth_tag
         FROM jm_secrets
        WHERE org_id = $1 AND user_id IS NULL AND name = $2`,
      [scope.orgId, secretName],
    );
    const row = r.rows[0];
    if (!row) return null;
    return open({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
  }

  // User-scope: any row keyed by this user. (org_id is also required in the
  // schema for user-scope rows, so the user must have at least one org membership.)
  const r = await pool.query(
    `SELECT ciphertext, iv, auth_tag
       FROM jm_secrets
      WHERE user_id = $1 AND name = $2
      LIMIT 1`,
    [scope.userId, secretName],
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
    `SELECT 1 FROM jm_secrets WHERE org_id = $1 AND user_id IS NULL AND name = $2 LIMIT 1`,
    [orgId, name],
  );
  return r.rowCount !== null && r.rowCount > 0;
}
