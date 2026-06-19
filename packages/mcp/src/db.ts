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
  workspaceId: string;
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
    workspaceId: r.workspace_id,
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
         (workspace_id, name, description, transport, command, args, url,
          bindings, system_prompt, enabled, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.workspaceId,
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
  pool: Pool, workspaceId: string,
): Promise<McpInstanceRecord[]> {
  const r = await pool.query(
    `SELECT * FROM jm_mcp_instances WHERE workspace_id = $1 ORDER BY name`,
    [workspaceId],
  );
  return r.rows.map(rowToRecord);
}

export async function getMcpInstance(
  pool: Pool, id: string, workspaceId: string,
): Promise<McpInstanceRecord | null> {
  const r = await pool.query(
    `SELECT * FROM jm_mcp_instances WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId],
  );
  return r.rows[0] ? rowToRecord(r.rows[0]) : null;
}

export interface UpdateInput {
  id: string;
  workspaceId: string;
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
  const params: any[] = [input.id, input.workspaceId];

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
      WHERE id = $1 AND workspace_id = $2`,
    params,
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteMcpInstance(
  pool: Pool, id: string, workspaceId: string,
): Promise<boolean> {
  const r = await pool.query(
    `DELETE FROM jm_mcp_instances WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId],
  );
  return (r.rowCount ?? 0) > 0;
}

export interface VisibleRow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
}

export async function listVisibleMcpInstances(
  pool: Pool, workspaceId: string,
): Promise<VisibleRow[]> {
  const r = await pool.query(
    `SELECT id, name, description, enabled
       FROM jm_mcp_instances
      WHERE workspace_id = $1
        AND enabled = true
      ORDER BY name`,
    [workspaceId],
  );
  return r.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
  }));
}

export async function fetchInstancesByIds(
  pool: Pool, workspaceId: string, ids: string[],
): Promise<McpInstanceRecord[]> {
  if (ids.length === 0) return [];
  const r = await pool.query(
    `SELECT * FROM jm_mcp_instances
      WHERE id = ANY($1::uuid[])
        AND workspace_id = $2
        AND enabled = true`,
    [ids, workspaceId],
  );
  return r.rows.map(rowToRecord);
}
