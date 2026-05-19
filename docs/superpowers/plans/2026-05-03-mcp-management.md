# MCP Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**User overrides for this plan:** No commits during implementation. No unit tests. Run `npm run typecheck` once at the end of the plan.

**Goal:** Add user/org-scoped MCP instance management — DB-backed registration, secret-bound credentials, system prompt fragments — and wire it into coding-cli (`analyze`, `plan`, `implement`) via a new `@journeyman/mcp` package.

**Architecture:** New `@journeyman/mcp` package mirrors `@journeyman/secrets`. Single `jm_mcp_instances` table. Subpath export `@journeyman/mcp/sdk-adapter` exposes pure transforms (DB-free) so `@journeyman/coding-cli` can consume them without leaking `pg`. Phase handlers accept already-resolved `ResolvedMcpInstance[]` via `PhaseInput.mcps` and pass them straight through to coding-cli.

**Tech Stack:** TypeScript, Node 22, Fastify, `pg`, `@anthropic-ai/claude-agent-sdk`, raw SQL migrations.

**Spec:** [`docs/superpowers/specs/2026-05-03-mcp-management-design.md`](../specs/2026-05-03-mcp-management-design.md)

---

## File Structure

### Created files

| Path | Responsibility |
|---|---|
| `packages/migrations/src/sql/009_mcp_instances.sql` | DB migration creating `jm_mcp_instances`. |
| `packages/core/src/types/mcp.types.ts` | `McpBinding`, `McpInstanceRecord`, `ResolvedMcpInstance`, `MissingMcpInstancesError`. |
| `packages/mcp/package.json` | Package manifest with subpath exports. |
| `packages/mcp/tsconfig.json` | TS config (mirrors `packages/secrets/tsconfig.json`). |
| `packages/mcp/src/index.ts` | Full-package exports (db, resolver, routes). |
| `packages/mcp/src/sdk-adapter.ts` | Pure transforms — `toMcpServerConfigs`, `mergeSystemPrompts`. |
| `packages/mcp/src/db.ts` | CRUD on `jm_mcp_instances`, validation, error classes. |
| `packages/mcp/src/resolver.ts` | `resolveMcpInstances(pool, ctx, ids)`. |
| `packages/mcp/src/routes/index.ts` | `registerMcpRoutes(app, pool)` orchestrator. |
| `packages/mcp/src/routes/user-mcp.ts` | User-scope CRUD routes. |
| `packages/mcp/src/routes/org-mcp.ts` | Org-scope CRUD routes (admin). |
| `packages/mcp/src/routes/visible.ts` | `GET /api/orgs/:orgId/mcp-instances/visible`. |
| `packages/mcp/src/routes/catalog.ts` | `GET /api/mcp-catalog` static catalog. |

### Modified files

| Path | Change |
|---|---|
| `packages/core/src/index.ts` | Re-export new `mcp.types.ts`. |
| `packages/core/src/types/coding.types.ts` | Add `mcps?: ResolvedMcpInstance[]` to `AnalyzeOptions`, `PlanOptions`, `ImplementOptions`. |
| `packages/coding-cli/package.json` | Add dep `@journeyman/mcp`. |
| `packages/coding-cli/src/providers/claude/operations/analyze.ts` | Inject `mcpServers`, expand `tools`/`allowedTools`, append merged system prompt. |
| `packages/coding-cli/src/providers/claude/operations/plan.ts` | Same as analyze. |
| `packages/coding-cli/src/providers/claude/operations/implement.ts` | Same as analyze. |
| `packages/api-server/package.json` | Add dep `@journeyman/mcp`. |
| `packages/api-server/src/server.ts` | Call `registerMcpRoutes(app, c.pool)` next to `registerSecretsRoutes`. |
| `packages/orchestrator/src/workers/phases/analyze-repo-phase-handler.ts` | Pass `input.mcps` through to `coding.analyze({mcps: ...})`. |
| `packages/orchestrator/src/workers/phases/plan-implementation-phase-handler.ts` | Same. |
| `packages/orchestrator/src/workers/phases/implement-changes-phase-handler.ts` | Same. |
| `packages/flow-editor/src/phase-definition.ts` | Add `supportsMcp?: boolean` to `PhaseDefinition`. |
| `CLAUDE.md` | Add `@journeyman/mcp` row to package table; mark MCP feature implemented. |

---

## Tasks

### Task 1: DB migration

**Files:**
- Create: `packages/migrations/src/sql/009_mcp_instances.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 009_mcp_instances.sql — user/org-scope MCP server instances.

CREATE TABLE IF NOT EXISTS jm_mcp_instances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES jm_orgs(id)  ON DELETE CASCADE,
  user_id       UUID          REFERENCES jm_users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  transport     TEXT NOT NULL CHECK (transport IN ('stdio','http','sse')),
  command       TEXT,
  args          JSONB,
  url           TEXT,
  bindings      JSONB NOT NULL DEFAULT '[]'::jsonb,
  system_prompt TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID NOT NULL REFERENCES jm_users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_mcp_instances_scope_unique UNIQUE NULLS NOT DISTINCT (org_id, user_id, name),
  CONSTRAINT jm_mcp_instances_transport_shape CHECK (
    (transport = 'stdio' AND command IS NOT NULL AND url IS NULL)
    OR (transport IN ('http','sse') AND url IS NOT NULL AND command IS NULL AND args IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_jm_mcp_instances_org_user ON jm_mcp_instances (org_id, user_id);
```

---

### Task 2: Core types — `mcp.types.ts`

**Files:**
- Create: `packages/core/src/types/mcp.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create `mcp.types.ts`**

```ts
export type McpTransport = "stdio" | "http" | "sse";

export interface McpBinding {
  envVar: string;
  secretName: string;
}

export interface McpInstanceRecord {
  id: string;
  orgId: string;
  userId: string | null;
  name: string;
  description: string | null;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  bindings: McpBinding[];
  systemPrompt: string | null;
  enabled: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolvedMcpInstance {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env: Record<string, string>;
  systemPrompt: string | null;
}

export class MissingMcpInstancesError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing or inaccessible MCP instances: ${missing.join(", ")}`);
    this.name = "MissingMcpInstancesError";
  }
}
```

- [ ] **Step 2: Re-export from `packages/core/src/index.ts`**

Add the line near the other `export * from "./types/..."` lines (next to `export * from "./types/secrets.types.ts";`):

```ts
export * from "./types/mcp.types.ts";
```

Re-export should appear in the `// Types` group at the top of the file.

---

### Task 3: Extend coding-cli option types

**Files:**
- Modify: `packages/core/src/types/coding.types.ts`

- [ ] **Step 1: Import `ResolvedMcpInstance`**

At the top of the file, add to the existing imports:

```ts
import type { ResolvedMcpInstance } from "./mcp.types.ts";
```

- [ ] **Step 2: Add `mcps` to `AnalyzeOptions`**

Locate `export type AnalyzeOptions = SessionOptions & { ... }`. Add inside the type body:

```ts
  /** Resolved MCP instances to attach to the SDK query. Empty/undefined ⇒ no MCPs. */
  mcps?: ResolvedMcpInstance[];
```

- [ ] **Step 3: Add `mcps` to `PlanOptions`**

Locate `export type PlanOptions = SessionOptions & { ... }`. Add the same field with the same docstring.

- [ ] **Step 4: Add `mcps` to `ImplementOptions`**

Locate `export type ImplementOptions = SessionOptions & { ... }`. Add the same field with the same docstring.

---

### Task 4: New `@journeyman/mcp` package skeleton

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/src/index.ts`

- [ ] **Step 1: Write `packages/mcp/package.json`**

```json
{
  "name": "@journeyman/mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./sdk-adapter": "./src/sdk-adapter.ts"
  },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "*",
    "@journeyman/core": "*",
    "@journeyman/identity": "*",
    "@journeyman/secrets": "*",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "@types/pg": "^8.11.10",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2: Write `packages/mcp/tsconfig.json`**

Read `packages/secrets/tsconfig.json` and copy its contents verbatim. The shape is identical for both packages.

- [ ] **Step 3: Write a placeholder `packages/mcp/src/index.ts`**

```ts
// Public surface — re-exported below as more files are added.
export {} from "./db.ts";
export { resolveMcpInstances } from "./resolver.ts";
export { registerMcpRoutes } from "./routes/index.ts";
```

This file will compile after Tasks 5–10 land. It's safe to commit a file referencing not-yet-created modules in this plan because we typecheck only at the end (per user override).

- [ ] **Step 4: Run install to register the workspace**

Run: `cd /Users/admin/data/workspace/claude-skils/journeyman && npm install`
Expected: workspace links the new `@journeyman/mcp` package.

---

### Task 5: `db.ts` — CRUD

**Files:**
- Create: `packages/mcp/src/db.ts`

- [ ] **Step 1: Write `db.ts` with full CRUD**

```ts
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
```

---

### Task 6: `resolver.ts`

**Files:**
- Create: `packages/mcp/src/resolver.ts`

- [ ] **Step 1: Write `resolver.ts`**

```ts
import type { Pool } from "pg";
import {
  MissingMcpInstancesError, MissingSecretsError,
  type ResolvedMcpInstance,
} from "@journeyman/core";
import { fetchForResolve } from "@journeyman/secrets/db.ts";
import { fetchInstancesByIds } from "./db.ts";

export interface ResolveCtx {
  orgId: string;
  userId: string;
}

export async function resolveMcpInstances(
  pool: Pool,
  ctx: ResolveCtx,
  instanceIds: string[],
): Promise<ResolvedMcpInstance[]> {
  if (instanceIds.length === 0) return [];

  const found = await fetchInstancesByIds(pool, ctx.orgId, ctx.userId, instanceIds);
  const byId = new Map(found.map((i) => [i.id, i]));
  const missing = instanceIds.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new MissingMcpInstancesError(missing);

  const allSecretNames = Array.from(
    new Set(found.flatMap((i) => i.bindings.map((b) => b.secretName))),
  );

  const secretRows = allSecretNames.length > 0
    ? await fetchForResolve(pool, ctx.orgId, ctx.userId, allSecretNames)
    : [];

  // user-scope wins over org-scope.
  const secretValues: Record<string, string> = {};
  for (const row of secretRows) {
    const isUser = row.userId === ctx.userId;
    if (isUser) secretValues[row.name] = row.value;
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
```

Note on the import `@journeyman/secrets/db.ts`: this requires the `@journeyman/secrets` package to expose `db.ts` via subpath. Check `packages/secrets/package.json` first — its `exports` map currently only exposes `.` and `./routes`.

- [ ] **Step 2: Add `./db` subpath export to `@journeyman/secrets`**

Read `packages/secrets/package.json`. Update the `exports` map to:

```json
"exports": {
  ".": "./src/index.ts",
  "./routes": "./src/routes/index.ts",
  "./db": "./src/db.ts"
}
```

- [ ] **Step 3: Fix the import in `resolver.ts`**

Change the import line from `from "@journeyman/secrets/db.ts"` to `from "@journeyman/secrets/db"`.

---

### Task 7: `sdk-adapter.ts` (pure)

**Files:**
- Create: `packages/mcp/src/sdk-adapter.ts`

- [ ] **Step 1: Write `sdk-adapter.ts`**

```ts
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { ResolvedMcpInstance } from "@journeyman/core";

/**
 * Convert resolved MCP instances into the SDK's mcpServers shape.
 *
 * The SDK keys the map by a server name. We use `instance.name`. If two
 * instances share the same name (one user-scope and one org-scope, allowed by
 * the unique-per-scope DB constraint), the second occurrence is suffixed.
 */
export function toMcpServerConfigs(
  resolved: ResolvedMcpInstance[],
): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  const seen = new Map<string, number>();
  for (const inst of resolved) {
    let key = inst.name;
    const count = seen.get(key) ?? 0;
    if (count > 0) key = `${inst.name}_${count + 1}`;
    seen.set(inst.name, count + 1);
    out[key] = buildConfig(inst);
  }
  return out;
}

function buildConfig(inst: ResolvedMcpInstance): McpServerConfig {
  if (inst.transport === "stdio") {
    return {
      type: "stdio",
      command: inst.command!,
      args: inst.args ?? [],
      env: inst.env,
    } as McpServerConfig;
  }
  // http or sse
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(inst.env)) {
    if (k === "AUTHORIZATION") headers["Authorization"] = `Bearer ${v}`;
    headers[k] = v;
  }
  return {
    type: inst.transport,
    url: inst.url!,
    headers,
  } as McpServerConfig;
}

/**
 * Concatenate non-empty system prompts with `\n\n`. Returns "" if none.
 */
export function mergeSystemPrompts(resolved: ResolvedMcpInstance[]): string {
  return resolved
    .map((i) => (i.systemPrompt ?? "").trim())
    .filter((s) => s.length > 0)
    .join("\n\n");
}
```

---

### Task 8: User-scope routes

**Files:**
- Create: `packages/mcp/src/routes/user-mcp.ts`

- [ ] **Step 1: Write `user-mcp.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  DuplicateMcpInstanceError,
  InvalidMcpInputError,
  deleteMcpInstance,
  getMcpInstance,
  insertMcpInstance,
  listMcpInstances,
  updateMcpInstance,
} from "../db.ts";

export async function registerUserMcpRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/users/me/mcp-instances",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rows = await listMcpInstances(pool, orgId, ctx.user.id);
      return rows;
    });

  app.post("/api/orgs/:orgId/users/me/mcp-instances",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as any;
      try {
        const rec = await insertMcpInstance(pool, {
          orgId,
          userId: ctx.user.id,
          name: body.name,
          description: body.description ?? null,
          transport: body.transport,
          command: body.command ?? null,
          args: body.args ?? null,
          url: body.url ?? null,
          bindings: body.bindings ?? [],
          systemPrompt: body.systemPrompt ?? null,
          enabled: body.enabled ?? true,
          createdBy: ctx.user.id,
        });
        reply.code(201);
        return rec;
      } catch (err) {
        if (err instanceof DuplicateMcpInstanceError) return reply.code(409).send({ error: err.message });
        if (err instanceof InvalidMcpInputError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

  app.get("/api/orgs/:orgId/users/me/mcp-instances/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rec = await getMcpInstance(pool, id, orgId, ctx.user.id);
      if (!rec) return reply.code(404).send({ error: "Not found" });
      return rec;
    });

  app.patch("/api/orgs/:orgId/users/me/mcp-instances/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as any;
      try {
        const ok = await updateMcpInstance(pool, {
          id, orgId, userId: ctx.user.id,
          description: body.description,
          command: body.command,
          args: body.args,
          url: body.url,
          bindings: body.bindings,
          systemPrompt: body.systemPrompt,
          enabled: body.enabled,
        });
        if (!ok) return reply.code(404).send({ error: "Not found" });
        return { ok: true };
      } catch (err) {
        if (err instanceof InvalidMcpInputError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

  app.delete("/api/orgs/:orgId/users/me/mcp-instances/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const ok = await deleteMcpInstance(pool, id, orgId, ctx.user.id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });
}
```

---

### Task 9: Org-scope routes

**Files:**
- Create: `packages/mcp/src/routes/org-mcp.ts`

- [ ] **Step 1: Write `org-mcp.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  DuplicateMcpInstanceError,
  InvalidMcpInputError,
  deleteMcpInstance,
  getMcpInstance,
  insertMcpInstance,
  listMcpInstances,
  updateMcpInstance,
} from "../db.ts";

export async function registerOrgMcpRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/mcp-instances",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rows = await listMcpInstances(pool, orgId, null);
      return rows;
    });

  app.post("/api/orgs/:orgId/mcp-instances",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as any;
      try {
        const rec = await insertMcpInstance(pool, {
          orgId,
          userId: null,
          name: body.name,
          description: body.description ?? null,
          transport: body.transport,
          command: body.command ?? null,
          args: body.args ?? null,
          url: body.url ?? null,
          bindings: body.bindings ?? [],
          systemPrompt: body.systemPrompt ?? null,
          enabled: body.enabled ?? true,
          createdBy: ctx.user.id,
        });
        reply.code(201);
        return rec;
      } catch (err) {
        if (err instanceof DuplicateMcpInstanceError) return reply.code(409).send({ error: err.message });
        if (err instanceof InvalidMcpInputError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

  app.get("/api/orgs/:orgId/mcp-instances/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rec = await getMcpInstance(pool, id, orgId, null);
      if (!rec) return reply.code(404).send({ error: "Not found" });
      return rec;
    });

  app.patch("/api/orgs/:orgId/mcp-instances/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as any;
      try {
        const ok = await updateMcpInstance(pool, {
          id, orgId, userId: null,
          description: body.description,
          command: body.command,
          args: body.args,
          url: body.url,
          bindings: body.bindings,
          systemPrompt: body.systemPrompt,
          enabled: body.enabled,
        });
        if (!ok) return reply.code(404).send({ error: "Not found" });
        return { ok: true };
      } catch (err) {
        if (err instanceof InvalidMcpInputError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

  app.delete("/api/orgs/:orgId/mcp-instances/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const ok = await deleteMcpInstance(pool, id, orgId, null);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });
}
```

---

### Task 10: Visible-list route

**Files:**
- Create: `packages/mcp/src/routes/visible.ts`

- [ ] **Step 1: Write `visible.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { listVisibleMcpInstances } from "../db.ts";

export async function registerVisibleMcpRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/mcp-instances/visible",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listVisibleMcpInstances(pool, orgId, ctx.user.id);
    });
}
```

---

### Task 11: Catalog route

**Files:**
- Create: `packages/mcp/src/routes/catalog.ts`

- [ ] **Step 1: Write `catalog.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { defaultMcpCatalog } from "@journeyman/flow-editor";

export async function registerMcpCatalogRoute(app: FastifyInstance) {
  app.get("/api/mcp-catalog", async () => defaultMcpCatalog);
}
```

- [ ] **Step 2: Add `@journeyman/flow-editor` dep to `packages/mcp/package.json`**

Edit `packages/mcp/package.json` and add `"@journeyman/flow-editor": "*"` to the `dependencies` block (alphabetically, between `@journeyman/core` and `@journeyman/identity`).

---

### Task 12: Routes orchestrator

**Files:**
- Create: `packages/mcp/src/routes/index.ts`

- [ ] **Step 1: Write `routes/index.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerUserMcpRoutes } from "./user-mcp.ts";
import { registerOrgMcpRoutes } from "./org-mcp.ts";
import { registerVisibleMcpRoutes } from "./visible.ts";
import { registerMcpCatalogRoute } from "./catalog.ts";

export async function registerMcpRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgMcpRoutes(app, pool);
  await registerUserMcpRoutes(app, pool);
  await registerVisibleMcpRoutes(app, pool);
  await registerMcpCatalogRoute(app);
}
```

- [ ] **Step 2: Update `packages/mcp/src/index.ts` to expose the public surface**

Replace the placeholder contents created in Task 4 Step 3 with:

```ts
export {
  DuplicateMcpInstanceError,
  InvalidMcpInputError,
  insertMcpInstance,
  listMcpInstances,
  getMcpInstance,
  updateMcpInstance,
  deleteMcpInstance,
  listVisibleMcpInstances,
  fetchInstancesByIds,
} from "./db.ts";
export { resolveMcpInstances } from "./resolver.ts";
export type { ResolveCtx } from "./resolver.ts";
export { registerMcpRoutes } from "./routes/index.ts";
```

---

### Task 13: Wire routes into api-server

**Files:**
- Modify: `packages/api-server/package.json`
- Modify: `packages/api-server/src/server.ts`

- [ ] **Step 1: Add dep to `packages/api-server/package.json`**

In the `dependencies` block, add `"@journeyman/mcp": "*"` (alphabetically — between `@journeyman/identity` and the next entry).

- [ ] **Step 2: Import in `server.ts`**

Add to the imports near `import { registerSecretsRoutes } from "@journeyman/secrets";`:

```ts
import { registerMcpRoutes } from "@journeyman/mcp";
```

- [ ] **Step 3: Register the routes**

Locate the existing block:
```ts
if (c.pool) {
  await registerSecretsRoutes(app, c.pool);
}
```

Add right after `registerSecretsRoutes`:

```ts
  await registerMcpRoutes(app, c.pool);
```

(Inside the same `if (c.pool)` block.)

- [ ] **Step 4: Run install to refresh workspace links**

Run: `npm install` from the repo root.

---

### Task 14: ClaudeProvider — `analyze.ts`

**Files:**
- Modify: `packages/coding-cli/package.json`
- Modify: `packages/coding-cli/src/providers/claude/operations/analyze.ts`

- [ ] **Step 1: Add dep to `packages/coding-cli/package.json`**

Add `"@journeyman/mcp": "*"` to the `dependencies` block (alphabetically).

- [ ] **Step 2: Add imports to `analyze.ts`**

At the top of the file, add to the existing imports:

```ts
import { toMcpServerConfigs, mergeSystemPrompts } from "@journeyman/mcp/sdk-adapter";
```

- [ ] **Step 3: Build MCP fragments before the `query()` call**

Find the line `let output: AnalyzeResult = { ...EMPTY_RESULT, sessionId };`. Immediately before that line (after the `controller` block), insert:

```ts
  const mcpServers = opts.mcps?.length ? toMcpServerConfigs(opts.mcps) : undefined;
  const mcpPromptSuffix = opts.mcps?.length ? mergeSystemPrompts(opts.mcps) : "";
  const mcpKeys = mcpServers ? Object.keys(mcpServers) : [];
  const mcpToolNames = mcpKeys.map((k) => `mcp__${k}`);
```

- [ ] **Step 4: Append MCP suffix to the prompt**

Locate the `for await (const msg of query({` block. The current `prompt:` line reads `prompt: buildPrompt(opts),`. Replace it with:

```ts
    prompt: mcpPromptSuffix ? `${buildPrompt(opts)}\n\n${mcpPromptSuffix}` : buildPrompt(opts),
```

- [ ] **Step 5: Expand `tools` and `allowedTools`**

Locate:
```ts
      tools: ["Bash", "Read", "Glob", "Grep", "Write"],
      allowedTools: ["Bash", "Read", "Glob", "Grep", "Write"],
```

Replace both lines with:

```ts
      tools: ["Bash", "Read", "Glob", "Grep", "Write", ...mcpToolNames],
      allowedTools: ["Bash", "Read", "Glob", "Grep", "Write", ...mcpToolNames],
```

- [ ] **Step 6: Inject `mcpServers` and update `allowedMcpServers`**

Locate:
```ts
      settings: { allowedMcpServers: [] },
```

Replace with:

```ts
      settings: { allowedMcpServers: mcpKeys },
      ...(mcpServers ? { mcpServers } : {}),
```

---

### Task 15: ClaudeProvider — `plan.ts`

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/plan.ts`

- [ ] **Step 1: Repeat Task 14 Steps 2–6 inside `plan.ts`**

The `tools`/`allowedTools` arrays in `plan.ts` are:
```ts
      tools: ["Bash", "Read", "Glob", "Grep", "Write"],
      allowedTools: ["Bash", "Read", "Glob", "Grep", "Write"],
```

The transformations are identical. Use the same code blocks shown in Task 14. The `prompt:` line in `plan.ts` reads `prompt: buildPrompt(opts),` (same as analyze) — apply the same wrap.

---

### Task 16: ClaudeProvider — `implement.ts`

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/implement.ts`

- [ ] **Step 1: Repeat Task 14 Steps 2–6 inside `implement.ts`**

The `tools`/`allowedTools` arrays in `implement.ts` are:
```ts
      tools: ["Bash", "Read", "Glob", "Grep", "Write", "Edit"],
      allowedTools: ["Bash", "Read", "Glob", "Grep", "Write", "Edit"],
```

So Step 5's replacement here is:

```ts
      tools: ["Bash", "Read", "Glob", "Grep", "Write", "Edit", ...mcpToolNames],
      allowedTools: ["Bash", "Read", "Glob", "Grep", "Write", "Edit", ...mcpToolNames],
```

All other steps are identical to Task 14.

---

### Task 17: Phase handlers pass `mcps` through

**Files:**
- Modify: `packages/orchestrator/src/workers/phases/analyze-repo-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/plan-implementation-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/implement-changes-phase-handler.ts`

These handlers receive `PhaseInput` (a `Record<string, unknown>`). The upstream caller is responsible for resolving `mcpInstanceIds` into `ResolvedMcpInstance[]` and writing it onto `input.mcps`. The handler's job is to pass it through to coding-cli when present.

- [ ] **Step 1: Update `analyze-repo-phase-handler.ts`**

Add to the imports near `import type { ICodingCLI, ... } from "@journeyman/core";`:

```ts
import type { ResolvedMcpInstance } from "@journeyman/core";
```

Locate the `await coding.analyze({...})` call:

```ts
    const result = await coding.analyze({
      workspaceDir,
      issue,
      sessionId: ctx.runId,
      signal: ctx.signal,
    });
```

Replace with:

```ts
    const mcps = Array.isArray(input.mcps) ? (input.mcps as ResolvedMcpInstance[]) : undefined;
    const result = await coding.analyze({
      workspaceDir,
      issue,
      sessionId: ctx.runId,
      signal: ctx.signal,
      ...(mcps ? { mcps } : {}),
    });
```

- [ ] **Step 2: Update `plan-implementation-phase-handler.ts`**

Same change pattern. Add the `ResolvedMcpInstance` import. Find the `await coding.plan({...})` call and add the same `mcps` extraction line above it, plus `...(mcps ? { mcps } : {}),` inside the call.

- [ ] **Step 3: Update `implement-changes-phase-handler.ts`**

Same change pattern. Add the `ResolvedMcpInstance` import. Find the `await coding.implement({...})` call and add the same `mcps` extraction line above it, plus `...(mcps ? { mcps } : {}),` inside the call.

> **Note:** The upstream code that resolves `phase.config.mcpInstanceIds` into `input.mcps` is part of the worker's input-construction pipeline — out of scope for this plan. Until that's wired, callers that need MCPs can populate `input.mcps` directly.

---

### Task 18: PhaseDefinition flag

**Files:**
- Modify: `packages/flow-editor/src/phase-definition.ts`

- [ ] **Step 1: Add `supportsMcp` flag**

Read the file. Locate the `PhaseDefinition` interface. Add inside the interface:

```ts
  /**
   * When true, the flow editor properties panel renders an MCP multi-select
   * populated from /api/orgs/:orgId/mcp-instances/visible. The chosen IDs are
   * stored on the phase config under `mcpInstanceIds: string[]`.
   */
  supportsMcp?: boolean;
```

> **Note:** Wiring up the flow-editor UI rendering of the multi-select is a follow-up — the flag declaration is sufficient to unblock the phase config schema for now.

---

### Task 19: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `@journeyman/mcp` to the package responsibilities table**

Find the markdown table beginning with `| Package | Scope |`. Add a new row at the bottom (after `@journeyman/notification-provider`):

```
| `@journeyman/mcp` | DB-backed MCP instance registry (user/org scope), routes for CRUD + visible-list + static catalog, resolver that produces `ResolvedMcpInstance[]`, and a pure subpath `@journeyman/mcp/sdk-adapter` consumed by `coding-cli`. |
```

- [ ] **Step 2: Add to Implementation Status**

Find the `## Implementation Status` table. Append rows:

```
| `@journeyman/mcp` package | Implemented |
| MCP instance CRUD (user + org routes) | Implemented |
| `resolveMcpInstances` resolver | Implemented |
| `toMcpServerConfigs` / `mergeSystemPrompts` (subpath export) | Implemented |
| `analyze`/`plan`/`implement` consume `mcps?: ResolvedMcpInstance[]` | Implemented |
| `PhaseDefinition.supportsMcp` flag | Implemented |
| Flow-editor MCP picker UI | Stub |
| Worker pre-resolution of `mcpInstanceIds → ResolvedMcpInstance[]` | Stub |
```

---

### Task 20: Final typecheck

**Files:** none

- [ ] **Step 1: Run typecheck across all workspaces**

Run from repo root:

```bash
npm run typecheck
```

Expected: every workspace passes. If any error appears, fix it before reporting completion.

Common failure modes to anticipate:
- Missing import: open the offending file and add the import based on the symbol name.
- `@journeyman/secrets/db` unresolved → confirm Task 6 Step 2 was applied to `packages/secrets/package.json` and re-run `npm install`.
- `McpServerConfig` not exported from `@anthropic-ai/claude-agent-sdk` → its actual name is one of `McpServerConfig | McpHttpServerConfig | McpStdioServerConfig`. Re-read `.claude/sdk.d.ts` and use whichever umbrella type the SDK exposes. If only the per-transport types exist, replace `McpServerConfig` with `McpHttpServerConfig | McpStdioServerConfig | McpSseServerConfig` (or similar) in `sdk-adapter.ts`.
- `FastifyRequest.runContext` typed as unknown → confirm `@journeyman/identity` is a dep of `@journeyman/mcp` (it is, per Task 4). The augmented type comes from that package.
- `req.body` shape errors → cast to `any` as the existing secrets routes do (already in the templates above).

---

## Self-Review Notes

- **Spec coverage:** Data model (Tasks 1–2), routes (Tasks 8–13), resolver (Task 6), SDK adapter (Task 7), coding-cli wiring (Tasks 3, 14–16), phase config flag (Task 18), worker pass-through (Task 17), docs (Task 19), final check (Task 20). All sections of the spec are addressed.
- **Out-of-scope items deferred** (called out as Stub in Task 19's status table): flow-editor UI rendering of the picker, upstream resolution of `mcpInstanceIds → mcps` in the worker's input pipeline. Both are noted in-place where they would otherwise be expected.
- **No commits / no tests** per user override. Final typecheck is the only validation step.
