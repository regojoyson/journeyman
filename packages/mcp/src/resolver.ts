import type { Pool } from "pg";
import {
  MissingMcpInstancesError, MissingSecretsError,
  type ResolvedMcpInstance,
} from "@journeyman/core";
import { fetchForResolve } from "@journeyman/secrets/db";
import { fetchInstancesByIds } from "./db.ts";

export interface ResolveCtx {
  /** Workspace for instance + secret resolution. Null/undefined => nothing resolves. */
  workspaceId?: string | null;
}

export async function resolveMcpInstances(
  pool: Pool,
  ctx: ResolveCtx,
  instanceIds: string[],
): Promise<ResolvedMcpInstance[]> {
  if (instanceIds.length === 0 || !ctx.workspaceId) return [];

  const found = await fetchInstancesByIds(pool, ctx.workspaceId, instanceIds);
  const byId = new Map(found.map((i) => [i.id, i]));
  const missing = instanceIds.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new MissingMcpInstancesError(missing);

  const allSecretNames = Array.from(
    new Set(found.flatMap((i) => i.bindings.map((b) => b.secretName))),
  );

  // Secrets resolution needs both org (for org-tier fallback) and workspace.
  // Derive org from the workspace row.
  let orgId: string | null = null;
  if (allSecretNames.length > 0) {
    const wsRow = await pool.query(
      `SELECT org_id FROM jm_workspaces WHERE id = $1`,
      [ctx.workspaceId],
    );
    orgId = wsRow.rows[0]?.org_id ?? null;
  }

  const workspaceId = ctx.workspaceId;
  const secretRows = allSecretNames.length > 0
    ? await fetchForResolve(pool, orgId, workspaceId, allSecretNames)
    : [];

  // workspace-scope wins over org-scope.
  const secretValues: Record<string, string> = {};
  for (const row of secretRows) {
    const isWorkspace = row.workspaceId !== null && row.workspaceId === workspaceId;
    if (isWorkspace) secretValues[row.name] = row.value;
    else if (secretValues[row.name] === undefined) secretValues[row.name] = row.value;
  }

  const missingSecrets = allSecretNames.filter((n) => secretValues[n] === undefined);
  if (missingSecrets.length > 0) throw new MissingSecretsError(missingSecrets);

  return instanceIds.map((id) => {
    const inst = byId.get(id)!;
    const env: Record<string, string> = {};
    for (const b of inst.bindings) env[b.envVar] = secretValues[b.secretName]!;
    return {
      id: inst.id,
      name: inst.name,
      transport: inst.transport,
      command: inst.command,
      args: inst.args,
      url: inst.url,
      env,
      systemPrompt: inst.systemPrompt,
    };
  });
}
