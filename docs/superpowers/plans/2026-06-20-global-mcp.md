# Global MCP Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `scope` column to `jm_mcp_instances` so platform-admin-created global MCPs (SQL-only, no UI creation) are visible to every workspace and protected from API mutation.

**Architecture:** A single new migration makes `workspace_id` nullable and adds a `scope TEXT` column (`'workspace' | 'global'`). A DB-level CHECK enforces the relationship. All existing workspace-scoped logic is unchanged; three query functions are widened to include global rows alongside workspace rows. Route handlers for PATCH and DELETE gain a 403 guard.

**Tech Stack:** PostgreSQL 16 (migrations via `journeyman-migrate`), TypeScript, Fastify, React + Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-20-global-mcp-design.md`

**Branch:** master (no commits; run `npm run typecheck` at end to verify)

---

## File Map

| Action | Path | What changes |
|--------|------|-------------|
| Create | `packages/migrations/src/sql/053_global_mcp_scope.sql` | New migration |
| Modify | `packages/core/src/types/mcp.types.ts` | Add `McpScope`, update `McpInstanceRecord` |
| Modify | `packages/mcp/src/db.ts` | `rowToRecord`, `listMcpInstances`, `listVisibleMcpInstances`, `getMcpInstance`, `fetchInstancesByIds`, `VisibleRow` |
| Modify | `packages/mcp/src/routes/workspace-mcp.ts` | POST guard, PATCH guard, DELETE guard |
| Modify | `packages/web/src/api/mcp.ts` | Add `scope` to `McpInstance` |
| Modify | `packages/web/src/routes/McpsPage.tsx` | Globe icon, hide edit/delete for global |

---

## Task 1: DB Migration

**Files:**
- Create: `packages/migrations/src/sql/053_global_mcp_scope.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 053_global_mcp_scope.sql
-- Add global scope to MCP instances.
-- workspace_id becomes nullable; scope column distinguishes the two cases.

ALTER TABLE jm_mcp_instances
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'workspace'
    CHECK (scope IN ('workspace', 'global'));

ALTER TABLE jm_mcp_instances
  ALTER COLUMN workspace_id DROP NOT NULL;

ALTER TABLE jm_mcp_instances
  ADD CONSTRAINT jm_mcp_instances_scope_coherence CHECK (
    (scope = 'workspace' AND workspace_id IS NOT NULL) OR
    (scope = 'global'    AND workspace_id IS NULL)
  );

-- Global MCP names must be unique across the platform.
CREATE UNIQUE INDEX jm_mcp_instances_global_name_unique
  ON jm_mcp_instances (name)
  WHERE scope = 'global';
```

- [ ] **Step 2: Apply the migration**

```bash
npm run migrate
```

Expected: "Applied 053_global_mcp_scope" with no errors. If infra is not running, start it first with `npm run infra:up`.

---

## Task 2: Core Types

**Files:**
- Modify: `packages/core/src/types/mcp.types.ts`

- [ ] **Step 1: Add `McpScope` and update `McpInstanceRecord`**

Replace the current `McpInstanceRecord` interface in `packages/core/src/types/mcp.types.ts`:

```typescript
export type McpTransport = "stdio" | "http" | "sse";

export type McpScope = "workspace" | "global";

export interface McpBinding {
  envVar: string;
  secretName: string;
}

export interface McpInstanceRecord {
  id: string;
  scope: McpScope;
  workspaceId: string | null;
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

---

## Task 3: DB Layer — `rowToRecord`, `listMcpInstances`, `listVisibleMcpInstances`

**Files:**
- Modify: `packages/mcp/src/db.ts`

- [ ] **Step 1: Update `rowToRecord` to include `scope`**

Find `rowToRecord` at line 58 of `packages/mcp/src/db.ts`. Replace it:

```typescript
function rowToRecord(r: any): McpInstanceRecord {
  return {
    id: r.id,
    scope: r.scope,
    workspaceId: r.workspace_id ?? null,
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
```

- [ ] **Step 2: Update `listMcpInstances` to include global rows**

Find `listMcpInstances` at line 107. Replace the query:

```typescript
export async function listMcpInstances(
  pool: Pool, workspaceId: string,
): Promise<McpInstanceRecord[]> {
  const r = await pool.query(
    `SELECT * FROM jm_mcp_instances
      WHERE workspace_id = $1 OR scope = 'global'
      ORDER BY name`,
    [workspaceId],
  );
  return r.rows.map(rowToRecord);
}
```

- [ ] **Step 3: Add `scope` to `VisibleRow` and update `listVisibleMcpInstances`**

Find `VisibleRow` at line 182 and `listVisibleMcpInstances` at line 189. Replace both:

```typescript
export interface VisibleRow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  scope: McpScope;
}

export async function listVisibleMcpInstances(
  pool: Pool, workspaceId: string,
): Promise<VisibleRow[]> {
  const r = await pool.query(
    `SELECT id, name, description, enabled, scope
       FROM jm_mcp_instances
      WHERE (workspace_id = $1 OR scope = 'global')
        AND enabled = true
      ORDER BY name`,
    [workspaceId],
  );
  return r.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    scope: row.scope,
  }));
}
```

You also need to add the import for `McpScope` at the top of the file. Find the existing import at line 2:

```typescript
import type { McpBinding, McpInstanceRecord, McpTransport } from "@journeyman/core";
```

Replace with:

```typescript
import type { McpBinding, McpInstanceRecord, McpScope, McpTransport } from "@journeyman/core";
```

---

## Task 4: DB Layer — `getMcpInstance` and `fetchInstancesByIds`

**Files:**
- Modify: `packages/mcp/src/db.ts`

- [ ] **Step 1: Update `getMcpInstance` to match global rows**

Find `getMcpInstance` at line 117. Replace the query so a global MCP can be fetched from any workspace route:

```typescript
export async function getMcpInstance(
  pool: Pool, id: string, workspaceId: string,
): Promise<McpInstanceRecord | null> {
  const r = await pool.query(
    `SELECT * FROM jm_mcp_instances
      WHERE id = $1
        AND (workspace_id = $2 OR scope = 'global')`,
    [id, workspaceId],
  );
  return r.rows[0] ? rowToRecord(r.rows[0]) : null;
}
```

- [ ] **Step 2: Update `fetchInstancesByIds` to include global rows**

Find `fetchInstancesByIds` at line 208. Replace the query:

```typescript
export async function fetchInstancesByIds(
  pool: Pool, workspaceId: string, ids: string[],
): Promise<McpInstanceRecord[]> {
  if (ids.length === 0) return [];
  const r = await pool.query(
    `SELECT * FROM jm_mcp_instances
      WHERE id = ANY($1::uuid[])
        AND enabled = true
        AND (workspace_id = $2 OR scope = 'global')`,
    [ids, workspaceId],
  );
  return r.rows.map(rowToRecord);
}
```

---

## Task 5: Route Guards

**Files:**
- Modify: `packages/mcp/src/routes/workspace-mcp.ts`

- [ ] **Step 1: Guard POST against `scope: 'global'` in the body**

Find the POST handler at line 43. Add a body check at the very start of the handler, before the `insertMcpInstance` call:

```typescript
app.post("/api/workspaces/:wsId/mcp-instances", write, async (req, reply) => {
  const { wsId } = req.params as { wsId: string };
  const ctx = req.runContext!;
  const body = req.body as any;
  if ((body as any).scope === "global") {
    return reply.code(400).send({ error: "scope 'global' cannot be set via API" });
  }
  try {
    const rec = await insertMcpInstance(pool, {
      workspaceId: wsId,
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
```

- [ ] **Step 2: Guard PATCH — fetch first, reject global with 403**

The current PATCH handler (line 82) calls `updateMcpInstance` directly without a prior fetch. Replace the entire PATCH handler:

```typescript
app.patch("/api/workspaces/:wsId/mcp-instances/:id", write, async (req, reply) => {
  const { wsId, id } = req.params as { wsId: string; id: string };
  const existing = await getMcpInstance(pool, id, wsId);
  if (!existing) return reply.code(404).send({ error: "Not found" });
  if (existing.scope === "global") {
    return reply.code(403).send({ error: "Global MCP instances cannot be edited" });
  }
  const body = req.body as any;
  try {
    await updateMcpInstance(pool, {
      id, workspaceId: wsId,
      description: body.description,
      command: body.command,
      args: body.args,
      url: body.url,
      bindings: body.bindings,
      systemPrompt: body.systemPrompt,
      enabled: body.enabled,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof InvalidMcpInputError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});
```

- [ ] **Step 3: Guard DELETE — fetch first, reject global with 403**

The current DELETE handler (line 104) calls `deleteMcpInstance` directly. Replace the entire DELETE handler:

```typescript
app.delete("/api/workspaces/:wsId/mcp-instances/:id", del, async (req, reply) => {
  const { wsId, id } = req.params as { wsId: string; id: string };
  const existing = await getMcpInstance(pool, id, wsId);
  if (!existing) return reply.code(404).send({ error: "Not found" });
  if (existing.scope === "global") {
    return reply.code(403).send({ error: "Global MCP instances cannot be deleted" });
  }
  await deleteMcpInstance(pool, id, wsId);
  return { ok: true };
});
```

---

## Task 6: Web API Type

**Files:**
- Modify: `packages/web/src/api/mcp.ts`

- [ ] **Step 1: Add `scope` to `McpInstance`**

Find the `McpInstance` interface at line 5. Replace it:

```typescript
export interface McpInstance {
  id: string;
  scope: "workspace" | "global";
  name: string;
  description: string | null;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  bindings: McpBinding[];
  systemPrompt: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

---

## Task 7: UI — Globe Icon and Read-Only Guard

**Files:**
- Modify: `packages/web/src/routes/McpsPage.tsx`

- [ ] **Step 1: Add globe icon to global MCPs in the table and hide Edit/Delete buttons**

Find the `<td>` cell for the name column (line 79) and the actions cell (lines 85–90). Replace the entire `<tr>` body from line 79 to 90:

```tsx
<tr key={r.id} className="hover:bg-surface-hover">
  <td className="px-6 py-3">
    <span className="inline-flex items-center gap-1.5">
      <code className={codePill}>{r.name}</code>
      {r.scope === "global" && (
        <span
          title="Global MCP — managed by your platform admin"
          className="text-slate-400"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-3.5 h-3.5 shrink-0"
          >
            <path d="M21.721 12.752a9.711 9.711 0 0 0-.945-5.003 12.754 12.754 0 0 1-4.339 2.708 18.991 18.991 0 0 1-.214 4.772 17.165 17.165 0 0 0 5.498-2.477ZM14.634 15.55a17.324 17.324 0 0 0 .332-4.647c-.952.227-1.945.347-2.966.347-1.021 0-2.014-.12-2.966-.347a17.515 17.515 0 0 0 .332 4.647 17.385 17.385 0 0 0 5.268 0ZM9.772 17.119a18.963 18.963 0 0 0 4.456 0A17.182 17.182 0 0 1 12 21.724a17.18 17.18 0 0 1-2.228-4.605ZM7.777 15.23a18.87 18.87 0 0 1-.214-4.774 12.753 12.753 0 0 1-4.34-2.708 9.711 9.711 0 0 0-.944 5.004 17.165 17.165 0 0 0 5.498 2.477ZM21.356 14.752a9.765 9.765 0 0 1-7.478 6.817 18.64 18.64 0 0 0 1.988-4.718 18.627 18.627 0 0 0 5.49-2.098ZM2.644 14.752c1.682.971 3.53 1.688 5.49 2.099a18.64 18.64 0 0 0 1.988 4.718 9.765 9.765 0 0 1-7.478-6.816ZM13.878 2.43a9.755 9.755 0 0 1 6.116 3.986 11.267 11.267 0 0 1-3.746 2.504 18.63 18.63 0 0 0-2.37-6.49ZM12 2.276a17.152 17.152 0 0 1 2.805 7.121c-.897.23-1.837.353-2.805.353-.968 0-1.908-.122-2.805-.353A17.151 17.151 0 0 1 12 2.276ZM10.122 2.43a18.629 18.629 0 0 0-2.37 6.49 11.266 11.266 0 0 1-3.746-2.504 9.754 9.754 0 0 1 6.116-3.985Z" />
          </svg>
        </span>
      )}
    </span>
  </td>
  <td className="px-6 py-3 text-slate-300">{r.transport}</td>
  <td className="px-6 py-3 text-slate-300">
    {r.bindings.length === 0 ? <span className="text-slate-600">—</span> : `${r.bindings.length} secret${r.bindings.length === 1 ? "" : "s"}`}
  </td>
  <td className="px-6 py-3 text-slate-400">{new Date(r.updatedAt).toLocaleString()}</td>
  <td className="px-6 py-3 text-right">
    <div className="flex justify-end gap-2">
      <button onClick={() => setTesting(r)} className={btnGhost}>Test</button>
      {canWrite && r.scope !== "global" && (
        <button onClick={() => setEditing(r)} className={btnGhost}>Edit</button>
      )}
      {canDelete && r.scope !== "global" && (
        <button onClick={() => remove(r)} className={btnDanger}>Delete</button>
      )}
    </div>
  </td>
</tr>
```

---

## Task 8: Typecheck

- [ ] **Step 1: Run the full typecheck**

```bash
npm run typecheck
```

Expected: exit 0, no errors. Common issues to watch for:
- If you see `Type 'string' is not assignable to type 'string | null'` in `db.ts` — check that `rowToRecord` returns `workspaceId: r.workspace_id ?? null`
- If you see `Property 'scope' does not exist on type 'VisibleRow'` in any component that uses `listVisibleMcpInstances` — make sure `VisibleRow` export in `db.ts` and re-export via `packages/mcp/src/index.ts` are updated
- If you see errors in `McpsPage.tsx` about `scope` — ensure `McpInstance` in `packages/web/src/api/mcp.ts` has `scope: "workspace" | "global"`
