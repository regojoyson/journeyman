import type { Pool } from "pg";
import type { RunContext, SecretScope } from "@journeyman/core";
import { listGlobalSecretNames } from "./global.ts";

export interface VisibleSecret {
  name: string;
  scope: SecretScope;
}

/**
 * Returns the names of secrets visible to the caller, tagged with their scope:
 *   - user: caller's own user-scope secrets in the active org
 *   - org:  the active org's org-scope secrets
 *   - global: JM_GLOBAL_* env names
 *
 * Precedence on resolve is user > org > global; the list reflects raw
 * accessibility (the same name may appear in multiple scopes).
 */
export async function listVisibleSecrets(pool: Pool, ctx: RunContext): Promise<VisibleSecret[]> {
  const r = await pool.query<{ name: string; user_id: string | null }>(
    `SELECT name, user_id FROM jm_secrets
      WHERE org_id = $1 AND (user_id = $2 OR user_id IS NULL)`,
    [ctx.org.id, ctx.user.id],
  );
  const out: VisibleSecret[] = [];
  for (const row of r.rows) {
    out.push({ name: row.name, scope: row.user_id ? "user" : "org" });
  }
  for (const g of listGlobalSecretNames()) {
    out.push({ name: g, scope: "global" });
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
  return out;
}

/**
 * Backwards-compatible flat name list. Used by save-time validation and
 * other paths that don't care about scope.
 */
export async function listVisibleNames(pool: Pool, ctx: RunContext): Promise<string[]> {
  const scoped = await listVisibleSecrets(pool, ctx);
  return [...new Set(scoped.map(s => s.name))].sort();
}
