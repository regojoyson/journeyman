import type { Pool } from "pg";
import type { Agent, AgentCreateInput, AgentUpdateInput } from "@journeyman/core";

export class DuplicateAgentError extends Error {
  constructor(name: string) {
    super(`agent "${name}" already exists`);
    this.name = "DuplicateAgentError";
  }
}

const COLUMN_KEYS = new Set([
  "id",
  "scope",
  "userId",
  "orgId",
  "name",
  "status",
  "enabled",
  "createdBy",
  "createdAt",
  "updatedAt",
]);

/** Everything that isn't a top-level column goes into the definition JSONB. */
function toDefinition(a: Record<string, unknown>): Record<string, unknown> {
  const def: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) if (!COLUMN_KEYS.has(k)) def[k] = v;
  return def;
}

export function rowToAgent(r: any): Agent {
  const d = r.definition ?? {};
  return {
    id: r.id,
    scope: r.scope,
    userId: r.user_id ?? undefined,
    orgId: r.org_id,
    name: r.name,
    status: r.status,
    enabled: r.enabled,
    instructions: d.instructions ?? "",
    inputs: d.inputs ?? [],
    provider: d.provider ?? "claude",
    model: d.model,
    connectorMcpIds: d.connectorMcpIds ?? [],
    tools: d.tools ?? [],
    skillIds: d.skillIds ?? [],
    repoSelections: d.repoSelections ?? [],
    sandboxId: d.sandboxId,
    permissions: d.permissions ?? { allowedTools: [] },
    notifications: d.notifications ?? { on: [] },
    outputMode: d.outputMode ?? "text",
    outputFields: d.outputFields,
    behavior: d.behavior ?? {},
    triggers: d.triggers ?? [],
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function buildInsert(
  input: AgentCreateInput & { orgId: string; userId: string | null; createdBy: string },
): { cols: string[]; vals: unknown[]; def: Record<string, unknown> } {
  const def = toDefinition(input as Record<string, unknown>);
  const cols = ["scope", "user_id", "org_id", "name", "status", "enabled", "definition", "created_by"];
  const vals = [
    input.scope,
    input.userId,
    input.orgId,
    input.name,
    (input as any).status ?? "draft",
    (input as any).enabled ?? false,
    def,
    input.createdBy,
  ];
  return { cols, vals, def };
}

export async function insertAgent(
  pool: Pool,
  input: AgentCreateInput & { orgId: string; userId: string | null; createdBy: string },
): Promise<Agent> {
  const { cols, vals } = buildInsert(input);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  try {
    const { rows } = await pool.query(
      `INSERT INTO jm_agents (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      vals,
    );
    return rowToAgent(rows[0]);
  } catch (err: any) {
    if (err.code === "23505") throw new DuplicateAgentError(input.name);
    throw err;
  }
}

export async function getAgent(pool: Pool, id: string): Promise<Agent | null> {
  const { rows } = await pool.query(`SELECT * FROM jm_agents WHERE id = $1`, [id]);
  return rows[0] ? rowToAgent(rows[0]) : null;
}

export async function listAgents(pool: Pool, orgId: string, userId: string | null): Promise<Agent[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_agents
     WHERE org_id = $1 AND COALESCE(user_id::text, '') = COALESCE($2::text, '')
     ORDER BY name ASC`,
    [orgId, userId],
  );
  return rows.map(rowToAgent);
}

export async function updateAgent(pool: Pool, id: string, patch: AgentUpdateInput): Promise<Agent | null> {
  const current = await getAgent(pool, id);
  if (!current) return null;

  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };

  if (patch.name !== undefined) push("name", patch.name);
  if (patch.status !== undefined) push("status", patch.status);
  if (patch.enabled !== undefined) push("enabled", patch.enabled);

  // Merge any definition-level fields into the existing definition doc.
  const defPatch = toDefinition(patch as Record<string, unknown>);
  if (Object.keys(defPatch).length > 0) {
    const mergedDef = { ...toDefinition(current as unknown as Record<string, unknown>), ...defPatch };
    push("definition", mergedDef);
  }

  if (sets.length === 0) return current;
  sets.push(`updated_at = now()`);
  vals.push(id);
  try {
    const { rows } = await pool.query(
      `UPDATE jm_agents SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
      vals,
    );
    return rows[0] ? rowToAgent(rows[0]) : null;
  } catch (err: any) {
    if (err.code === "23505") throw new DuplicateAgentError(patch.name ?? current.name);
    throw err;
  }
}

export async function deleteAgent(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM jm_agents WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Find an enabled agent whose webhook trigger references this webhookId
 * (Phase 3b webhook ingest). Returns null if no enabled agent uses the webhook.
 */
export async function findAgentByWebhookId(pool: Pool, webhookId: string): Promise<Agent | null> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_agents
      WHERE enabled = true AND definition->'triggers' @> $1::jsonb
      LIMIT 1`,
    [JSON.stringify([{ type: "webhook", webhookId }])],
  );
  return rows[0] ? rowToAgent(rows[0]) : null;
}
