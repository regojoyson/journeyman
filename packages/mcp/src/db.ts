import type { Pool } from "pg";
import type { McpBinding, McpInstanceRecord, McpTransport } from "@journeyman/core";

const NAME_RE = /^[a-zA-Z0-9_\- ]{1,64}$/;
const ENV_RE = /^[A-Z][A-Z0-9_]*$/;

export class DuplicateMcpInstanceError extends Error {
  constructor(name: string) {
    super(`MCP instance already exists: ${name}`);
    this.name = "DuplicateMcpInstanceError";
  }
}

export class InvalidMcpInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMcpInputError";
  }
}

export interface UpsertInput {
  orgId: string;
  userId: string | null;
  name: string;
  description?: string | null;
  transport: McpTransport;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  bindings: McpBinding[];
  systemPrompt?: string | null;
  enabled?: boolean;
  createdBy: string;
}

export function validateUpsert(input: UpsertInput): void {
  if (!NAME_RE.test(input.name)) {
    throw new InvalidMcpInputError(`Invalid MCP name: ${input.name}`);
  }
  if (input.transport === "stdio") {
    if (!input.command) throw new InvalidMcpInputError("stdio transport requires command");
    if (input.url) throw new InvalidMcpInputError("stdio transport must not set url");
  } else {
    if (!input.url) throw new InvalidMcpInputError(`${input.transport} transport requires url`);
    if (input.command || input.args) {
      throw new InvalidMcpInputError(`${input.transport} transport must not set command or args`);
    }
  }
  for (const b of input.bindings) {
    if (!ENV_RE.test(b.envVar)) {
      throw new InvalidMcpInputError(`Invalid binding envVar: ${b.envVar}`);
    }
    if (typeof b.secretName !== "string" || b.secretName.length === 0) {
      throw new InvalidMcpInputError(`Invalid binding secretName for ${b.envVar}`);
    }
  }
}

function rowToRecord(r: any): McpInstanceRecord {
  return {
    id: r.id,
    orgId: r.org_id,
    userId: r.user_id,
    name: r.name,
    description: r.description,
    transport: r.transport,
    command: r.command ?? undefined,
    args: r.args ?? undefined,
    url: r.url ?? undefined,
    bindings: r.bindings ?? [],
    systemPrompt: r.system_prompt,
    enabled: r.enabled,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function insertMcpInstance(pool: Pool, input: UpsertInput): Promise<McpInstanceRecord> {
  validateUpsert(input);
  try {
    const r = await pool.query(
      `INSERT INTO jm_mcp_instances
         (org_id, user_id, name, description, transport, command, args, url,
          bindings, system_prompt, enabled, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        input.orgId,
        input.userId,
        input.name,
        input.description ?? null,
        input.transport,
        input.command ?? null,
        input.args ? JSON.stringify(input.args) : null,
        input.url ?? null,
        JSON.stringify(input.bindings),
        input.systemPrompt ?? null,
        input.enabled ?? true,
        input.createdBy,
      ],
    );
    return rowToRecord(r.rows[0]);
  } catch (err: any) {
    if (err.code === "23505") throw new DuplicateMcpInstanceError(input.name);
    throw err;
  }
}

export async function listMcpInstances(
  pool: Pool, orgId: string, userId: string | null,
): Promise<McpInstanceRecord[]> {
  const userClause = userId === null ? "AND user_id IS NULL" : "AND user_id = $2";
  const params: any[] = userId === null ? [orgId] : [orgId, userId];
  const r = await pool.query(
    `SELECT * FROM jm_mcp_instances WHERE org_id = $1 ${userClause} ORDER BY name`,
    params,
  );
  return r.rows.map(rowToRecord);
}

export async function getMcpInstance(
  pool: Pool, id: string, orgId: string, userId: string | null,
): Promise<McpInstanceRecord | null> {
  const userClause = userId === null ? "AND user_id IS NULL" : "AND user_id = $3";
  const params: any[] = userId === null ? [id, orgId] : [id, orgId, userId];
  const r = await pool.query(
    `SELECT * FROM jm_mcp_instances WHERE id = $1 AND org_id = $2 ${userClause}`,
    params,
  );
  return r.rows[0] ? rowToRecord(r.rows[0]) : null;
}

export async function getUserMcpInstanceById(
  pool: Pool, id: string, orgId: string,
): Promise<McpInstanceRecord | null> {
  const r = await pool.query(
    `SELECT * FROM jm_mcp_instances
      WHERE id = $1 AND org_id = $2 AND user_id IS NOT NULL`,
    [id, orgId],
  );
  return r.rows[0] ? rowToRecord(r.rows[0]) : null;
}

export interface UpdateInput {
  id: string;
  orgId: string;
  userId: string | null;
  description?: string | null;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  bindings?: McpBinding[];
  systemPrompt?: string | null;
  enabled?: boolean;
}

export async function updateMcpInstance(pool: Pool, input: UpdateInput): Promise<boolean> {
  const sets: string[] = [];
  const params: any[] = [input.id, input.orgId];
  const userClause = input.userId === null ? "AND user_id IS NULL" : "AND user_id = $3";
  if (input.userId !== null) params.push(input.userId);

  const push = (col: string, value: any) => {
    sets.push(`${col} = $${params.length + 1}`);
    params.push(value);
  };

  if (input.description !== undefined) push("description", input.description);
  if (input.command !== undefined) push("command", input.command);
  if (input.args !== undefined) push("args", input.args === null ? null : JSON.stringify(input.args));
  if (input.url !== undefined) push("url", input.url);
  if (input.bindings !== undefined) {
    for (const b of input.bindings) {
      if (!ENV_RE.test(b.envVar)) throw new InvalidMcpInputError(`Invalid binding envVar: ${b.envVar}`);
    }
    push("bindings", JSON.stringify(input.bindings));
  }
  if (input.systemPrompt !== undefined) push("system_prompt", input.systemPrompt);
  if (input.enabled !== undefined) push("enabled", input.enabled);

  if (sets.length === 0) return true;
  sets.push("updated_at = now()");

  const r = await pool.query(
    `UPDATE jm_mcp_instances SET ${sets.join(", ")}
      WHERE id = $1 AND org_id = $2 ${userClause}`,
    params,
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteMcpInstance(
  pool: Pool, id: string, orgId: string, userId: string | null,
): Promise<boolean> {
  const userClause = userId === null ? "AND user_id IS NULL" : "AND user_id = $3";
  const params: any[] = userId === null ? [id, orgId] : [id, orgId, userId];
  const r = await pool.query(
    `DELETE FROM jm_mcp_instances WHERE id = $1 AND org_id = $2 ${userClause}`,
    params,
  );
  return (r.rowCount ?? 0) > 0;
}

export interface VisibleRow {
  id: string;
  name: string;
  description: string | null;
  scope: "user" | "org";
  enabled: boolean;
}

export async function listVisibleMcpInstances(
  pool: Pool, orgId: string, userId: string,
): Promise<VisibleRow[]> {
  const r = await pool.query(
    `SELECT id, name, description, user_id, enabled
       FROM jm_mcp_instances
      WHERE org_id = $1
        AND enabled = true
        AND (user_id = $2 OR user_id IS NULL)
      ORDER BY name`,
    [orgId, userId],
  );
  return r.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    scope: row.user_id === null ? "org" : "user",
    enabled: row.enabled,
  }));
}

export async function fetchInstancesByIds(
  pool: Pool, orgId: string, userId: string, ids: string[],
): Promise<McpInstanceRecord[]> {
  if (ids.length === 0) return [];
  const r = await pool.query(
    `SELECT * FROM jm_mcp_instances
      WHERE id = ANY($1::uuid[])
        AND org_id = $2
        AND (user_id = $3 OR user_id IS NULL)
        AND enabled = true`,
    [ids, orgId, userId],
  );
  return r.rows.map(rowToRecord);
}

export interface PromoteInput {
  userInstanceId: string;
  orgId: string;
  name: string;
  description: string | null;
  systemPrompt: string | null;
  bindings: McpBinding[];
  enabled: boolean;
  promotedBy: string;
}

export async function promoteToOrg(pool: Pool, input: PromoteInput): Promise<McpInstanceRecord> {
  for (const b of input.bindings) {
    if (!ENV_RE.test(b.envVar)) {
      throw new InvalidMcpInputError(`Invalid binding envVar: ${b.envVar}`);
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orig = await client.query(
      `SELECT * FROM jm_mcp_instances
        WHERE id = $1 AND org_id = $2 AND user_id IS NOT NULL
        FOR UPDATE`,
      [input.userInstanceId, input.orgId],
    );
    if (orig.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new InvalidMcpInputError("user MCP not found");
    }
    const o = orig.rows[0];

    let inserted;
    try {
      inserted = await client.query(
        `INSERT INTO jm_mcp_instances
           (org_id, user_id, name, description, transport, command, args, url,
            bindings, system_prompt, enabled, created_by)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          input.orgId,
          input.name,
          input.description,
          o.transport,
          o.command,
          o.args,
          o.url,
          JSON.stringify(input.bindings),
          input.systemPrompt,
          input.enabled,
          input.promotedBy,
        ],
      );
    } catch (err: any) {
      await client.query("ROLLBACK");
      if (err.code === "23505") throw new DuplicateMcpInstanceError(input.name);
      throw err;
    }

    await client.query(`DELETE FROM jm_mcp_instances WHERE id = $1`, [input.userInstanceId]);

    await client.query("COMMIT");
    return rowToRecord(inserted.rows[0]);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* swallow */ }
    throw err;
  } finally {
    client.release();
  }
}

export interface PromotableRow {
  id: string;
  name: string;
  transport: McpTransport;
  ownerId: string;
  ownerEmail: string;
  bindingCount: number;
  updatedAt: Date;
}

export async function listPromotable(pool: Pool, orgId: string): Promise<PromotableRow[]> {
  const r = await pool.query(
    `SELECT m.id, m.name, m.transport, m.user_id, m.bindings, m.updated_at,
            u.username AS owner_email
       FROM jm_mcp_instances m
       JOIN jm_users u ON u.id = m.user_id
      WHERE m.org_id = $1 AND m.user_id IS NOT NULL
      ORDER BY u.username, m.name`,
    [orgId],
  );
  return r.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    transport: row.transport,
    ownerId: row.user_id,
    ownerEmail: row.owner_email,
    bindingCount: Array.isArray(row.bindings) ? row.bindings.length : 0,
    updatedAt: row.updated_at,
  }));
}
