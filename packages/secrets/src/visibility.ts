import type { Pool } from "pg";
import type { RunContext, SecretScope } from "@journeyman/core";

export interface VisibleSecret {
  name: string;
  scope: SecretScope;
}

/**
 * Returns the names of secrets visible to the caller, tagged with their scope:
 *   - workspace: the active workspace's secrets
 *   - org:       the active org's org-scope secrets
 *
 * Precedence on resolve is workspace > org; the list reflects raw
 * accessibility (the same name may appear in both scopes).
 */
export async function listVisibleSecrets(pool: Pool, ctx: RunContext): Promise<VisibleSecret[]> {
  const workspaceId = ctx.workspace?.id ?? null;
  const r = await pool.query<{ name: string; workspace_id: string | null }>(
    `SELECT name, workspace_id FROM jm_secrets
      WHERE org_id = $1 AND (workspace_id IS NULL ${workspaceId ? "OR workspace_id = $2" : ""})`,
    workspaceId ? [ctx.org.id, workspaceId] : [ctx.org.id],
  );
  const out: VisibleSecret[] = r.rows.map(row => ({
    name: row.name,
    scope: (row.workspace_id ? "workspace" : "org") as SecretScope,
  }));
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
