# MCP Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**User overrides for this plan:** No commits during implementation. No unit tests. Run `npm run typecheck` once at the end.

**Goal:** Build user-facing pages to manage MCP instances — `/me/mcps` for personal, `/admin/mcps` for org-level — with an admin-only "Promote user → org" flow that drops user-scope secret bindings and forces re-binding to org/global secrets.

**Architecture:** New React routes inside `@journeyman/web` mirroring the secrets pages. Two new backend endpoints in `@journeyman/mcp`: `POST /promote` and `GET /promotable`. Client-side filtering of the existing `/secrets/_visible-names` response (which already returns scope-tagged names) — no secrets-package changes.

**Tech Stack:** React, react-router, plain `fetch`, Tailwind utility classes (existing `admin-styles.ts`), Fastify, `pg`.

**Spec:** [`docs/superpowers/specs/2026-05-03-mcp-management-ui-design.md`](../specs/2026-05-03-mcp-management-ui-design.md)

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `packages/web/src/api/mcp.ts` | Typed fetch wrappers for MCP endpoints. |
| `packages/web/src/api/secrets.ts` | Typed fetch wrapper around `/secrets/_visible-names` returning scope-tagged entries. (New helper file — avoids inlining the call in every component.) |
| `packages/web/src/routes/MyMcpsPage.tsx` | User-scope MCPs page. |
| `packages/web/src/routes/AdminMcpsPage.tsx` | Org-scope MCPs page + promotable list. |
| `packages/web/src/components/mcp/AddFromCatalogModal.tsx` | Two-step catalog wizard. |
| `packages/web/src/components/mcp/AddCustomModal.tsx` | Free-form MCP creation modal. |
| `packages/web/src/components/mcp/EditMcpModal.tsx` | Edit existing MCP (transport read-only). |
| `packages/web/src/components/mcp/PromoteMcpDialog.tsx` | Admin's promote flow. |
| `packages/web/src/components/mcp/SecretPicker.tsx` | `<select>` of secrets, filtered by scope. |
| `packages/web/src/components/mcp/BindingsEditor.tsx` | Repeater control for `{ envVar, secretName }` rows. |
| `packages/mcp/src/routes/promote.ts` | `POST /api/orgs/:orgId/mcp-instances/:userInstanceId/promote`. |
| `packages/mcp/src/routes/promotable.ts` | `GET /api/orgs/:orgId/mcp-instances/promotable`. |

### Modified

| Path | Change |
|---|---|
| `packages/mcp/src/db.ts` | Add `getUserMcpInstanceById`, `promoteToOrg` helpers. |
| `packages/mcp/src/routes/index.ts` | Register the two new routes. |
| `packages/web/src/App.tsx` | Add `/me/mcps` and `/admin/mcps` routes. |
| `packages/web/src/components/AppShell.tsx` | Add nav links. |

---

## Tasks

### Task 1: Backend — `db.ts` helpers for promotion

**Files:**
- Modify: `packages/mcp/src/db.ts`

- [ ] **Step 1: Add `getUserMcpInstanceById` helper**

Open `packages/mcp/src/db.ts`. Find the existing `getMcpInstance` function. Right after it, add:

```ts
/** Fetch a user-scope MCP instance regardless of which user owns it.
 *  Used by admin promotion flow — admin needs to load any user's MCP in their org. */
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
```

- [ ] **Step 2: Add `promoteToOrg` helper (transactional)**

At the bottom of the file, append:

```ts
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
  // Validate envVar regex on bindings (re-using same rules as upsert).
  const ENV_RE = /^[A-Z][A-Z0-9_]*$/;
  for (const b of input.bindings) {
    if (!ENV_RE.test(b.envVar)) {
      throw new InvalidMcpInputError(`Invalid binding envVar: ${b.envVar}`);
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // 1. Lock and fetch original.
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

    // 2. Insert org-scope row carrying transport-shape from original.
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

    // 3. Delete the user-scope original.
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
```

- [ ] **Step 3: Add `listPromotable` helper**

At the bottom of the file, append:

```ts
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
            u.email AS owner_email
       FROM jm_mcp_instances m
       JOIN jm_users u ON u.id = m.user_id
      WHERE m.org_id = $1 AND m.user_id IS NOT NULL
      ORDER BY u.email, m.name`,
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
```

> **Note:** Verify the column name on `jm_users` for the email field. The schema uses `email` per the secrets resolver pattern. If your local schema differs (e.g. `username`), substitute. Check `packages/migrations/src/sql/002_identity.sql` if unsure.

---

### Task 2: Backend — `promote.ts` route

**Files:**
- Create: `packages/mcp/src/routes/promote.ts`

- [ ] **Step 1: Write the route**

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  fetchPinnedOrgSecret,
  readGlobalSecrets,
} from "@journeyman/secrets/db";
import {
  DuplicateMcpInstanceError,
  InvalidMcpInputError,
  getUserMcpInstanceById,
  promoteToOrg,
} from "../db.ts";
import type { McpBinding } from "@journeyman/core";

export async function registerPromoteMcpRoute(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.post(
    "/api/orgs/:orgId/mcp-instances/:userInstanceId/promote",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, userInstanceId } = req.params as { orgId: string; userInstanceId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });

      const orig = await getUserMcpInstanceById(pool, userInstanceId, orgId);
      if (!orig) return reply.code(404).send({ error: "Not found" });

      const body = req.body as {
        name?: string;
        description?: string | null;
        systemPrompt?: string | null;
        bindings?: McpBinding[];
        enabled?: boolean;
      };

      const bindings = Array.isArray(body.bindings) ? body.bindings : [];

      // Validate every secretName resolves to org or global scope.
      const globalNames = new Set(Object.keys(readGlobalSecrets()));
      const unresolved: string[] = [];
      for (const b of bindings) {
        if (globalNames.has(b.secretName)) continue;
        const orgVal = await fetchPinnedOrgSecret(pool, orgId, b.secretName);
        if (orgVal === null) unresolved.push(b.secretName);
      }
      if (unresolved.length > 0) {
        return reply.code(400).send({
          error: `secrets not in org/global scope: ${unresolved.join(", ")}`,
          unresolved,
        });
      }

      try {
        const rec = await promoteToOrg(pool, {
          userInstanceId,
          orgId,
          name: body.name ?? orig.name,
          description: body.description ?? orig.description,
          systemPrompt: body.systemPrompt ?? orig.systemPrompt,
          bindings,
          enabled: body.enabled ?? orig.enabled,
          promotedBy: ctx.user.id,
        });
        reply.code(201);
        return rec;
      } catch (err) {
        if (err instanceof DuplicateMcpInstanceError) return reply.code(409).send({ error: err.message });
        if (err instanceof InvalidMcpInputError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );
}
```

> **Note:** This file imports `fetchPinnedOrgSecret` and `readGlobalSecrets` from `@journeyman/secrets/db`. The first is already exported (used in the resolve flow). `readGlobalSecrets` lives in `packages/secrets/src/global.ts`, which `db.ts` may not re-export. If the import fails at typecheck, change the import line to `import { readGlobalSecrets } from "@journeyman/secrets";` (the package root re-exports `global.ts`).

---

### Task 3: Backend — `promotable.ts` route

**Files:**
- Create: `packages/mcp/src/routes/promotable.ts`

- [ ] **Step 1: Write the route**

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { listPromotable } from "../db.ts";

export async function registerPromotableMcpRoute(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/orgs/:orgId/mcp-instances/promotable",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listPromotable(pool, orgId);
    },
  );
}
```

---

### Task 4: Backend — register both routes + export helpers

**Files:**
- Modify: `packages/mcp/src/routes/index.ts`
- Modify: `packages/mcp/src/index.ts`

- [ ] **Step 1: Register in `routes/index.ts`**

Open `packages/mcp/src/routes/index.ts`. Replace the file with:

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerUserMcpRoutes } from "./user-mcp.ts";
import { registerOrgMcpRoutes } from "./org-mcp.ts";
import { registerVisibleMcpRoutes } from "./visible.ts";
import { registerMcpCatalogRoute } from "./catalog.ts";
import { registerPromoteMcpRoute } from "./promote.ts";
import { registerPromotableMcpRoute } from "./promotable.ts";

export async function registerMcpRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgMcpRoutes(app, pool);
  await registerUserMcpRoutes(app, pool);
  await registerVisibleMcpRoutes(app, pool);
  await registerMcpCatalogRoute(app);
  await registerPromoteMcpRoute(app, pool);
  await registerPromotableMcpRoute(app, pool);
}
```

- [ ] **Step 2: Re-export new helpers from package root**

Open `packages/mcp/src/index.ts`. Update the `from "./db.ts"` export block to add the new helpers:

```ts
export {
  DuplicateMcpInstanceError,
  InvalidMcpInputError,
  insertMcpInstance,
  listMcpInstances,
  getMcpInstance,
  getUserMcpInstanceById,
  updateMcpInstance,
  deleteMcpInstance,
  listVisibleMcpInstances,
  fetchInstancesByIds,
  promoteToOrg,
  listPromotable,
} from "./db.ts";
```

(Leave the rest of the file alone.)

---

### Task 5: Web API client — `api/mcp.ts`

**Files:**
- Create: `packages/web/src/api/mcp.ts`

- [ ] **Step 1: Write the file**

```ts
export type McpTransport = "stdio" | "http" | "sse";

export interface McpBinding { envVar: string; secretName: string }

export interface McpInstance {
  id: string;
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

export interface CatalogEntry {
  id: string;
  label: string;
  source: "builtin" | "provided";
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  requiredEnv?: string[];
  description?: string;
}

export interface PromotableRow {
  id: string;
  name: string;
  transport: McpTransport;
  ownerId: string;
  ownerEmail: string;
  bindingCount: number;
  updatedAt: string;
}

export interface UpsertBody {
  name: string;
  description?: string;
  transport: McpTransport;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  bindings: McpBinding[];
  systemPrompt?: string;
  enabled?: boolean;
}

const userBase = (orgId: string) => `/api/orgs/${orgId}/users/me/mcp-instances`;
const orgBase = (orgId: string) => `/api/orgs/${orgId}/mcp-instances`;

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) return r.json() as Promise<T>;
  const body = await r.json().catch(() => ({}));
  throw new Error(body?.error ?? `HTTP ${r.status}`);
}

export const mcpApi = {
  listMy: (orgId: string) =>
    fetch(userBase(orgId), { credentials: "include" }).then(jsonOrThrow<McpInstance[]>),

  listOrg: (orgId: string) =>
    fetch(orgBase(orgId), { credentials: "include" }).then(jsonOrThrow<McpInstance[]>),

  listPromotable: (orgId: string) =>
    fetch(`${orgBase(orgId)}/promotable`, { credentials: "include" }).then(jsonOrThrow<PromotableRow[]>),

  catalog: () =>
    fetch("/api/mcp-catalog", { credentials: "include" }).then(jsonOrThrow<CatalogEntry[]>),

  createMy: (orgId: string, body: UpsertBody) =>
    fetch(userBase(orgId), {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<McpInstance>),

  createOrg: (orgId: string, body: UpsertBody) =>
    fetch(orgBase(orgId), {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<McpInstance>),

  updateMy: (orgId: string, id: string, body: Partial<UpsertBody>) =>
    fetch(`${userBase(orgId)}/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<{ ok: true }>),

  updateOrg: (orgId: string, id: string, body: Partial<UpsertBody>) =>
    fetch(`${orgBase(orgId)}/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<{ ok: true }>),

  removeMy: (orgId: string, id: string) =>
    fetch(`${userBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" })
      .then(jsonOrThrow<{ ok: true }>),

  removeOrg: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" })
      .then(jsonOrThrow<{ ok: true }>),

  promote: (orgId: string, userInstanceId: string, body: {
    name?: string; description?: string; systemPrompt?: string;
    bindings: McpBinding[]; enabled?: boolean;
  }) =>
    fetch(`${orgBase(orgId)}/${userInstanceId}/promote`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<McpInstance>),
};
```

---

### Task 6: Web API client — `api/secrets.ts`

**Files:**
- Create: `packages/web/src/api/secrets.ts`

- [ ] **Step 1: Write the file**

```ts
export type SecretScope = "user" | "org" | "global";

export interface VisibleSecret { name: string; scope: SecretScope }

export async function fetchVisibleSecrets(orgId: string): Promise<VisibleSecret[]> {
  const r = await fetch(`/api/orgs/${orgId}/secrets/_visible-names`, { credentials: "include" });
  if (!r.ok) return [];
  const body = await r.json();
  // Endpoint returns { names: string[]; scoped: VisibleSecret[] }.
  return Array.isArray(body?.scoped) ? body.scoped : [];
}

export function filterSecrets(
  secrets: VisibleSecret[],
  mode: "all" | "org-and-global",
): VisibleSecret[] {
  if (mode === "all") return secrets;
  return secrets.filter((s) => s.scope !== "user");
}
```

---

### Task 7: Web component — `SecretPicker.tsx`

**Files:**
- Create: `packages/web/src/components/mcp/SecretPicker.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from "react";
import { selectCls } from "../../routes/admin-styles.ts";
import { fetchVisibleSecrets, filterSecrets, type VisibleSecret } from "../../api/secrets.ts";

export interface SecretPickerProps {
  orgId: string;
  value: string;                                 // selected secretName
  onChange: (name: string) => void;
  scope: "all" | "org-and-global";
  required?: boolean;
}

export function SecretPicker(props: SecretPickerProps) {
  const [secrets, setSecrets] = useState<VisibleSecret[]>([]);
  useEffect(() => {
    let alive = true;
    fetchVisibleSecrets(props.orgId).then((list) => {
      if (alive) setSecrets(filterSecrets(list, props.scope));
    });
    return () => { alive = false; };
  }, [props.orgId, props.scope]);

  // De-dupe by name, keeping highest-precedence scope (user > org > global).
  const order: Record<VisibleSecret["scope"], number> = { user: 0, org: 1, global: 2 };
  const byName = new Map<string, VisibleSecret>();
  for (const s of secrets) {
    const existing = byName.get(s.name);
    if (!existing || order[s.scope] < order[existing.scope]) byName.set(s.name, s);
  }
  const options = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <select
      className={selectCls}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      required={props.required}
    >
      <option value="">— select —</option>
      {options.map((s) => (
        <option key={`${s.name}:${s.scope}`} value={s.name}>
          {s.name} ({s.scope})
        </option>
      ))}
    </select>
  );
}
```

---

### Task 8: Web component — `BindingsEditor.tsx`

**Files:**
- Create: `packages/web/src/components/mcp/BindingsEditor.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { btnGhost, btnDanger, inputCls } from "../../routes/admin-styles.ts";
import { SecretPicker } from "./SecretPicker.tsx";

export interface Binding { envVar: string; secretName: string }

export interface BindingsEditorProps {
  orgId: string;
  value: Binding[];
  onChange: (next: Binding[]) => void;
  scope: "all" | "org-and-global";
}

export function BindingsEditor(props: BindingsEditorProps) {
  const update = (i: number, next: Partial<Binding>) => {
    const out = props.value.map((b, idx) => idx === i ? { ...b, ...next } : b);
    props.onChange(out);
  };
  const remove = (i: number) => props.onChange(props.value.filter((_, idx) => idx !== i));
  const add = () => props.onChange([...props.value, { envVar: "", secretName: "" }]);

  return (
    <div className="space-y-2">
      {props.value.map((b, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={inputCls + " flex-1"}
            placeholder="ENV_VAR"
            value={b.envVar}
            onChange={(e) => update(i, { envVar: e.target.value.toUpperCase() })}
          />
          <span className="text-slate-500">→</span>
          <div className="flex-1">
            <SecretPicker
              orgId={props.orgId}
              value={b.secretName}
              onChange={(name) => update(i, { secretName: name })}
              scope={props.scope}
            />
          </div>
          <button type="button" onClick={() => remove(i)} className={btnDanger}>✕</button>
        </div>
      ))}
      <button type="button" onClick={add} className={btnGhost}>+ Add binding</button>
    </div>
  );
}
```

---

### Task 9: Web component — `AddCustomModal.tsx`

**Files:**
- Create: `packages/web/src/components/mcp/AddCustomModal.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
import { btnGhost, btnPrimary, card, inputCls } from "../../routes/admin-styles.ts";
import { mcpApi, type McpTransport, type UpsertBody } from "../../api/mcp.ts";
import { BindingsEditor, type Binding } from "./BindingsEditor.tsx";

export interface AddCustomModalProps {
  orgId: string;
  scope: "user" | "org";
  onClose: () => void;
  onCreated: () => void;
}

export function AddCustomModal(props: AddCustomModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [transport, setTransport] = useState<McpTransport>("stdio");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [url, setUrl] = useState("");
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const body: UpsertBody = {
      name,
      description: description || undefined,
      transport,
      bindings,
      systemPrompt: systemPrompt || undefined,
    };
    if (transport === "stdio") {
      body.command = command;
      body.args = argsText.split("\n").map((s) => s.trim()).filter(Boolean);
    } else {
      body.url = url;
    }
    try {
      if (props.scope === "user") await mcpApi.createMy(props.orgId, body);
      else await mcpApi.createOrg(props.orgId, body);
      props.onCreated();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-xl max-h-[90vh] overflow-y-auto p-6`}>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">Add custom MCP</h2>
        <form onSubmit={submit} className="space-y-4">
          <input className={inputCls} placeholder="Name" required value={name} onChange={e => setName(e.target.value)} />
          <input className={inputCls} placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
          <textarea className={inputCls} placeholder="System prompt (optional)" rows={3} value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} />

          <div className="flex gap-4 text-sm text-slate-300">
            {(["stdio", "http", "sse"] as McpTransport[]).map((t) => (
              <label key={t} className="flex items-center gap-2">
                <input type="radio" name="transport" checked={transport === t} onChange={() => setTransport(t)} />
                {t}
              </label>
            ))}
          </div>

          {transport === "stdio" ? (
            <>
              <input className={inputCls} placeholder="Command (e.g. npx)" required value={command} onChange={e => setCommand(e.target.value)} />
              <textarea className={inputCls} placeholder="Args (one per line)" rows={3} value={argsText} onChange={e => setArgsText(e.target.value)} />
            </>
          ) : (
            <input className={inputCls} placeholder="URL" required value={url} onChange={e => setUrl(e.target.value)} />
          )}

          <div>
            <div className="text-sm text-slate-300 mb-2">Bindings</div>
            <BindingsEditor
              orgId={props.orgId}
              value={bindings}
              onChange={setBindings}
              scope={props.scope === "org" ? "org-and-global" : "all"}
            />
          </div>

          {error && <div className="text-sm text-rose-400">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "Creating…" : "Create MCP"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

---

### Task 10: Web component — `AddFromCatalogModal.tsx`

**Files:**
- Create: `packages/web/src/components/mcp/AddFromCatalogModal.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from "react";
import { btnGhost, btnPrimary, card, codePill, inputCls } from "../../routes/admin-styles.ts";
import { mcpApi, type CatalogEntry, type UpsertBody } from "../../api/mcp.ts";
import { SecretPicker } from "./SecretPicker.tsx";

export interface AddFromCatalogModalProps {
  orgId: string;
  scope: "user" | "org";
  onClose: () => void;
  onCreated: () => void;
}

export function AddFromCatalogModal(props: AddFromCatalogModalProps) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [chosen, setChosen] = useState<CatalogEntry | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [bindings, setBindings] = useState<Record<string, string>>({});  // envVar -> secretName
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mcpApi.catalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  function pickEntry(e: CatalogEntry) {
    setChosen(e);
    setName(e.label);
    setDescription(e.description ?? "");
    const initial: Record<string, string> = {};
    for (const ev of e.requiredEnv ?? []) initial[ev] = "";
    setBindings(initial);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true); setError(null);
    const body: UpsertBody = {
      name,
      description: description || undefined,
      systemPrompt: systemPrompt || undefined,
      transport: chosen.transport,
      command: chosen.command,
      args: chosen.args,
      url: chosen.url,
      bindings: Object.entries(bindings)
        .filter(([, v]) => v)
        .map(([envVar, secretName]) => ({ envVar, secretName })),
    };
    try {
      if (props.scope === "user") await mcpApi.createMy(props.orgId, body);
      else await mcpApi.createOrg(props.orgId, body);
      props.onCreated();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-xl max-h-[90vh] overflow-y-auto p-6`}>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">
          {chosen ? `Configure ${chosen.label}` : "Add from catalog"}
        </h2>

        {!chosen ? (
          <div className="grid grid-cols-2 gap-3">
            {catalog.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pickEntry(c)}
                className={`${card} p-3 text-left hover:border-indigo-500 transition`}
              >
                <div className="text-sm font-medium text-slate-100">{c.label}</div>
                <div className="mt-1 flex gap-1">
                  <span className={codePill}>{c.transport}</span>
                  <span className={codePill}>{c.source}</span>
                </div>
                {c.description && (
                  <div className="mt-2 text-xs text-slate-400">{c.description}</div>
                )}
              </button>
            ))}
            {catalog.length === 0 && (
              <div className="col-span-2 text-sm text-slate-500 text-center py-6">Catalog is empty.</div>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <input className={inputCls} placeholder="Name" required value={name} onChange={e => setName(e.target.value)} />
            <input className={inputCls} placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
            <textarea className={inputCls} placeholder="System prompt (optional)" rows={3} value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} />

            <div className="text-xs text-slate-400">
              Transport <span className={codePill}>{chosen.transport}</span>
              {chosen.url && <> · URL <span className={codePill}>{chosen.url}</span></>}
              {chosen.command && <> · Command <span className={codePill}>{chosen.command}</span></>}
            </div>

            {(chosen.requiredEnv ?? []).length > 0 && (
              <div className="space-y-2">
                <div className="text-sm text-slate-300">Required bindings</div>
                {(chosen.requiredEnv ?? []).map((ev) => (
                  <div key={ev} className="flex items-center gap-2">
                    <code className={codePill}>{ev}</code>
                    <span className="text-slate-500">→</span>
                    <SecretPicker
                      orgId={props.orgId}
                      value={bindings[ev] ?? ""}
                      onChange={(secretName) => setBindings((prev) => ({ ...prev, [ev]: secretName }))}
                      scope={props.scope === "org" ? "org-and-global" : "all"}
                      required
                    />
                  </div>
                ))}
              </div>
            )}

            {error && <div className="text-sm text-rose-400">{error}</div>}

            <div className="flex justify-between pt-2">
              <button type="button" onClick={() => setChosen(null)} className={btnGhost}>← Back</button>
              <div className="flex gap-2">
                <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
                <button type="submit" disabled={busy} className={btnPrimary}>
                  {busy ? "Saving…" : "Add MCP"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

---

### Task 11: Web component — `EditMcpModal.tsx`

**Files:**
- Create: `packages/web/src/components/mcp/EditMcpModal.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
import { btnGhost, btnPrimary, card, codePill, inputCls } from "../../routes/admin-styles.ts";
import { mcpApi, type McpInstance } from "../../api/mcp.ts";
import { BindingsEditor, type Binding } from "./BindingsEditor.tsx";

export interface EditMcpModalProps {
  orgId: string;
  scope: "user" | "org";
  mcp: McpInstance;
  onClose: () => void;
  onSaved: () => void;
}

export function EditMcpModal(props: EditMcpModalProps) {
  const [description, setDescription] = useState(props.mcp.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(props.mcp.systemPrompt ?? "");
  const [command, setCommand] = useState(props.mcp.command ?? "");
  const [argsText, setArgsText] = useState((props.mcp.args ?? []).join("\n"));
  const [url, setUrl] = useState(props.mcp.url ?? "");
  const [bindings, setBindings] = useState<Binding[]>(props.mcp.bindings);
  const [enabled, setEnabled] = useState(props.mcp.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const body: any = { description, systemPrompt, bindings, enabled };
    if (props.mcp.transport === "stdio") {
      body.command = command;
      body.args = argsText.split("\n").map((s) => s.trim()).filter(Boolean);
    } else {
      body.url = url;
    }
    try {
      if (props.scope === "user") await mcpApi.updateMy(props.orgId, props.mcp.id, body);
      else await mcpApi.updateOrg(props.orgId, props.mcp.id, body);
      props.onSaved();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-xl max-h-[90vh] overflow-y-auto p-6`}>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">Edit MCP</h2>
        <div className="text-sm text-slate-400 mb-4">
          <code className={codePill}>{props.mcp.name}</code>
          <span className="ml-2">transport: <code className={codePill}>{props.mcp.transport}</code> (read-only)</span>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input className={inputCls} placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} />
          <textarea className={inputCls} placeholder="System prompt" rows={3} value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} />

          {props.mcp.transport === "stdio" ? (
            <>
              <input className={inputCls} placeholder="Command" value={command} onChange={e => setCommand(e.target.value)} />
              <textarea className={inputCls} placeholder="Args (one per line)" rows={3} value={argsText} onChange={e => setArgsText(e.target.value)} />
            </>
          ) : (
            <input className={inputCls} placeholder="URL" value={url} onChange={e => setUrl(e.target.value)} />
          )}

          <div>
            <div className="text-sm text-slate-300 mb-2">Bindings</div>
            <BindingsEditor
              orgId={props.orgId}
              value={bindings}
              onChange={setBindings}
              scope={props.scope === "org" ? "org-and-global" : "all"}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            Enabled
          </label>

          {error && <div className="text-sm text-rose-400">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

---

### Task 12: Web component — `PromoteMcpDialog.tsx`

**Files:**
- Create: `packages/web/src/components/mcp/PromoteMcpDialog.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from "react";
import { btnGhost, btnPrimary, card, codePill, inputCls } from "../../routes/admin-styles.ts";
import { mcpApi, type McpInstance, type PromotableRow } from "../../api/mcp.ts";
import { SecretPicker } from "./SecretPicker.tsx";

export interface PromoteMcpDialogProps {
  orgId: string;
  promotable: PromotableRow;
  onClose: () => void;
  onPromoted: () => void;
}

export function PromoteMcpDialog(props: PromoteMcpDialogProps) {
  const [original, setOriginal] = useState<McpInstance | null>(null);
  const [name, setName] = useState(props.promotable.name);
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The owner is some user; we don't have a route to GET another user's MCP by id. Instead,
    // we rely on the promotable list having enough info, plus we re-fetch via the org-scope path
    // /api/orgs/:orgId/mcp-instances/:id which (per the existing route) only returns org-scope rows.
    // So we cannot read the original's full body from the admin's perspective without a new route.
    //
    // For this iteration: build the binding rows from the promotable row's `bindingCount` only.
    // The admin types the env var names manually (matched to the ones the user originally bound).
    //
    // If the bindingCount is > 0, we display N empty rows; the admin must remember the env var
    // names. This is acceptable because the original user knows what their MCP needed and the
    // admin is presumably coordinating with them. A future enhancement could expose the original
    // env var names via a dedicated admin-readable endpoint.
    setOriginal(null);
    const init: Record<string, string> = {};
    for (let i = 0; i < props.promotable.bindingCount; i++) init[`__binding_${i}`] = "";
    setBindings(init);
  }, [props.promotable.id]);

  function setBindingEnv(key: string, envVar: string) {
    setBindings((prev) => {
      const out: Record<string, string> = {};
      for (const k of Object.keys(prev)) {
        if (k === key) out[envVar.toUpperCase()] = prev[k];
        else out[k] = prev[k];
      }
      return out;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const body = {
      name,
      description: description || undefined,
      systemPrompt: systemPrompt || undefined,
      bindings: Object.entries(bindings)
        .filter(([k, v]) => !k.startsWith("__binding_") && v)
        .map(([envVar, secretName]) => ({ envVar, secretName })),
    };
    try {
      await mcpApi.promote(props.orgId, props.promotable.id, body);
      props.onPromoted();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-xl max-h-[90vh] overflow-y-auto p-6`}>
        <h2 className="text-lg font-semibold text-slate-100">Promote to org level</h2>
        <p className="mt-2 text-sm text-slate-400">
          Owner: <code className={codePill}>{props.promotable.ownerEmail}</code>.
          The user-level MCP will be removed. Bindings must be re-mapped to org or global secrets.
        </p>

        <form onSubmit={submit} className="space-y-4 mt-4">
          <input className={inputCls} placeholder="Name in org" required value={name} onChange={e => setName(e.target.value)} />
          <input className={inputCls} placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
          <textarea className={inputCls} placeholder="System prompt (optional)" rows={3} value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} />

          {props.promotable.bindingCount > 0 && (
            <div className="space-y-2">
              <div className="text-sm text-slate-300">
                Re-bind {props.promotable.bindingCount} secret(s) (org/global only)
              </div>
              {Object.keys(bindings).map((key, idx) => {
                const isPlaceholder = key.startsWith("__binding_");
                return (
                  <div key={key} className="flex items-center gap-2">
                    <input
                      className={inputCls + " flex-1"}
                      placeholder={`ENV_VAR_${idx + 1}`}
                      value={isPlaceholder ? "" : key}
                      onChange={(e) => setBindingEnv(key, e.target.value)}
                    />
                    <span className="text-slate-500">→</span>
                    <div className="flex-1">
                      <SecretPicker
                        orgId={props.orgId}
                        value={bindings[key]}
                        onChange={(name) => setBindings((prev) => ({ ...prev, [key]: name }))}
                        scope="org-and-global"
                        required
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {error && <div className="text-sm text-rose-400">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "Promoting…" : "Promote"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

> **Note on a tradeoff in this dialog:** Admins must type the env var names themselves (the dialog can't read another user's MCP body without a new admin endpoint). The ergonomic shortcut is to extend `listPromotable` to also return the env var name list. If you want to do that now: change `PromotableRow` server-side to add `bindingEnvVars: string[]`, populate it from `bindings.map(b => b.envVar)` in `listPromotable`, then in this component pre-fill keys with the env var names instead of `__binding_${i}`. That is a strict improvement; it's only listed as an enhancement here to keep the diff small. If you prefer the better UX, do it now; the code path is identical.

---

### Task 13: Web page — `MyMcpsPage.tsx`

**Files:**
- Create: `packages/web/src/routes/MyMcpsPage.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { useEffect, useState } from "react";
import { btnDanger, btnGhost, btnPrimary, card, codePill } from "./admin-styles.ts";
import { mcpApi, type McpInstance } from "../api/mcp.ts";
import { AddFromCatalogModal } from "../components/mcp/AddFromCatalogModal.tsx";
import { AddCustomModal } from "../components/mcp/AddCustomModal.tsx";
import { EditMcpModal } from "../components/mcp/EditMcpModal.tsx";

export function MyMcpsPage(props: { orgId: string }) {
  const [rows, setRows] = useState<McpInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"catalog" | "custom" | null>(null);
  const [editing, setEditing] = useState<McpInstance | null>(null);

  async function refresh() {
    setLoading(true);
    try { setRows(await mcpApi.listMy(props.orgId)); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, [props.orgId]);

  async function remove(row: McpInstance) {
    if (!confirm(`Delete MCP "${row.name}"?`)) return;
    await mcpApi.removeMy(props.orgId, row.id);
    refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">My MCPs</h1>
            <p className="mt-1 text-sm text-slate-400">
              Personal MCP servers available to your runs.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModal("catalog")} className={btnGhost}>+ Add from catalog</button>
            <button onClick={() => setModal("custom")} className={btnPrimary}>+ Add custom</button>
          </div>
        </header>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="text-base font-medium text-slate-100">
              Your MCPs <span className="text-slate-500 font-normal">({rows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No personal MCPs yet. Use "Add from catalog" or "Add custom" above.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Transport</th>
                  <th className="text-left font-medium px-6 py-3">Bindings</th>
                  <th className="text-left font-medium px-6 py-3">Updated</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3"><code className={codePill}>{r.name}</code></td>
                    <td className="px-6 py-3 text-slate-300">{r.transport}</td>
                    <td className="px-6 py-3 text-slate-300">
                      {r.bindings.length === 0 ? <span className="text-slate-600">—</span> : `${r.bindings.length} secret${r.bindings.length === 1 ? "" : "s"}`}
                    </td>
                    <td className="px-6 py-3 text-slate-400">{new Date(r.updatedAt).toLocaleString()}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditing(r)} className={btnGhost}>Edit</button>
                        <button onClick={() => remove(r)} className={btnDanger}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {modal === "catalog" && (
        <AddFromCatalogModal orgId={props.orgId} scope="user" onClose={() => setModal(null)} onCreated={refresh} />
      )}
      {modal === "custom" && (
        <AddCustomModal orgId={props.orgId} scope="user" onClose={() => setModal(null)} onCreated={refresh} />
      )}
      {editing && (
        <EditMcpModal orgId={props.orgId} scope="user" mcp={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
    </div>
  );
}
```

---

### Task 14: Web page — `AdminMcpsPage.tsx`

**Files:**
- Create: `packages/web/src/routes/AdminMcpsPage.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { useEffect, useState } from "react";
import { btnDanger, btnGhost, btnPrimary, card, codePill } from "./admin-styles.ts";
import { mcpApi, type McpInstance, type PromotableRow } from "../api/mcp.ts";
import { AddFromCatalogModal } from "../components/mcp/AddFromCatalogModal.tsx";
import { AddCustomModal } from "../components/mcp/AddCustomModal.tsx";
import { EditMcpModal } from "../components/mcp/EditMcpModal.tsx";
import { PromoteMcpDialog } from "../components/mcp/PromoteMcpDialog.tsx";

export function AdminMcpsPage(props: { orgId: string }) {
  const [orgRows, setOrgRows] = useState<McpInstance[]>([]);
  const [promotable, setPromotable] = useState<PromotableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"catalog" | "custom" | null>(null);
  const [editing, setEditing] = useState<McpInstance | null>(null);
  const [promoting, setPromoting] = useState<PromotableRow | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        mcpApi.listOrg(props.orgId),
        mcpApi.listPromotable(props.orgId),
      ]);
      setOrgRows(a);
      setPromotable(b);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, [props.orgId]);

  async function remove(row: McpInstance) {
    if (!confirm(`Delete org MCP "${row.name}"?`)) return;
    await mcpApi.removeOrg(props.orgId, row.id);
    refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Org MCPs</h1>
            <p className="mt-1 text-sm text-slate-400">
              Org-wide MCPs visible to everyone in this organization.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModal("catalog")} className={btnGhost}>+ Add from catalog</button>
            <button onClick={() => setModal("custom")} className={btnPrimary}>+ Add custom</button>
          </div>
        </header>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="text-base font-medium text-slate-100">
              Org MCPs <span className="text-slate-500 font-normal">({orgRows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : orgRows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No org MCPs yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Transport</th>
                  <th className="text-left font-medium px-6 py-3">Bindings</th>
                  <th className="text-left font-medium px-6 py-3">Updated</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {orgRows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3"><code className={codePill}>{r.name}</code></td>
                    <td className="px-6 py-3 text-slate-300">{r.transport}</td>
                    <td className="px-6 py-3 text-slate-300">
                      {r.bindings.length === 0 ? <span className="text-slate-600">—</span> : `${r.bindings.length} secret${r.bindings.length === 1 ? "" : "s"}`}
                    </td>
                    <td className="px-6 py-3 text-slate-400">{new Date(r.updatedAt).toLocaleString()}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditing(r)} className={btnGhost}>Edit</button>
                        <button onClick={() => remove(r)} className={btnDanger}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="text-base font-medium text-slate-100">
              Promotable from users <span className="text-slate-500 font-normal">({promotable.length})</span>
            </h2>
          </div>
          {promotable.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No user-level MCPs in this org.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Owner</th>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Transport</th>
                  <th className="text-left font-medium px-6 py-3">Bindings</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {promotable.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3 text-slate-300">{r.ownerEmail}</td>
                    <td className="px-6 py-3"><code className={codePill}>{r.name}</code></td>
                    <td className="px-6 py-3 text-slate-300">{r.transport}</td>
                    <td className="px-6 py-3 text-slate-300">{r.bindingCount}</td>
                    <td className="px-6 py-3 text-right">
                      <button onClick={() => setPromoting(r)} className={btnPrimary}>Promote →</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {modal === "catalog" && (
        <AddFromCatalogModal orgId={props.orgId} scope="org" onClose={() => setModal(null)} onCreated={refresh} />
      )}
      {modal === "custom" && (
        <AddCustomModal orgId={props.orgId} scope="org" onClose={() => setModal(null)} onCreated={refresh} />
      )}
      {editing && (
        <EditMcpModal orgId={props.orgId} scope="org" mcp={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
      {promoting && (
        <PromoteMcpDialog orgId={props.orgId} promotable={promoting} onClose={() => setPromoting(null)} onPromoted={refresh} />
      )}
    </div>
  );
}
```

---

### Task 15: Routes + nav wiring in App.tsx and AppShell

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/AppShell.tsx`

- [ ] **Step 1: Add imports + routes in `App.tsx`**

Open `packages/web/src/App.tsx`. Find the import block. Add near the existing secrets imports:

```ts
import { MyMcpsPage } from "./routes/MyMcpsPage.tsx";
import { AdminMcpsPage } from "./routes/AdminMcpsPage.tsx";
```

Find the `<Routes>` block. Right after the `/me/secrets` route, add:

```tsx
<Route path="/me/mcps" element={<MyMcpsPage orgId={activeOrgId} />} />
```

Right after the `/admin/secrets` route, add:

```tsx
<Route path="/admin/mcps" element={role === "admin" ? <AdminMcpsPage orgId={activeOrgId} /> : <Navigate to="/" replace />} />
```

- [ ] **Step 2: Add nav links in `AppShell.tsx`**

Open `packages/web/src/components/AppShell.tsx`. Find the `<nav>` block containing the existing `NavLink`s. Right after the `My Secrets` link, add:

```tsx
<NavLink to="/me/mcps" style={navStyle}>My MCPs</NavLink>
```

Right after the admin-gated `Org Secrets` line, add:

```tsx
{role === "admin" && <NavLink to="/admin/mcps" style={navStyle}>Org MCPs</NavLink>}
```

If the file also has a mobile/sheet menu duplicate of these links (search for `to="/me/secrets"` outside the top nav), mirror the additions there too.

---

### Task 16: Final typecheck

**Files:** none

- [ ] **Step 1: Run typecheck across all workspaces**

```bash
npm install
npm run typecheck
```

Expected: every workspace passes (the pre-existing `@journeyman/web/FlowEditorPage.tsx:40` error is independent and not addressed by this plan; treat success as: no *new* errors from these changes).

Common failure modes to anticipate:
- `email` column missing on `jm_users` → check `packages/migrations/src/sql/002_identity.sql`. If the column is `username`, change `u.email AS owner_email` to `u.username AS owner_email` in `listPromotable` and rename the field consistently in `PromotableRow` + the React type.
- `readGlobalSecrets` not exported from `@journeyman/secrets/db` → switch the import in `promote.ts` to `import { readGlobalSecrets } from "@journeyman/secrets";`.
- React JSX errors in newly created `.tsx` files → confirm the new files were created in `packages/web/src/...` (which has JSX in tsconfig) and not anywhere else.
- `req.body` typed as `unknown` → cast with `as any` to match existing route style (already done in templates).

---

## Self-Review Notes

- **Spec coverage:**
  - MyMcpsPage / AdminMcpsPage → Tasks 13, 14
  - Add-from-catalog modal → Task 10
  - Add-custom modal → Task 9
  - Edit modal → Task 11
  - Promote dialog → Task 12
  - Promote endpoint → Task 2 (route) + Task 1 (db helper)
  - Promotable endpoint → Task 3 (route) + Task 1 (db helper)
  - Secret picker scope filtering → Tasks 6, 7 (client-side filter on existing endpoint — no backend retrofit)
  - Nav + routing → Task 15
  - Final check → Task 16

- **Deviation from the spec:** the spec proposed retrofitting `/secrets/_visible-names` with a `?scope=` parameter. After exploring the existing route, the response already returns `scoped: { name, scope }[]`, so client-side filtering is sufficient and zero backend churn is needed. The spec's status table entry "secrets/visible-names?scope=org-and-global" is satisfied without code changes there — the filtering lives in `web/src/api/secrets.ts` instead.

- **Tradeoff acknowledged in Task 12:** the promote dialog cannot read another user's MCP body (no admin-readable single-MCP endpoint exists), so it asks the admin to type env var names. This is documented as a "Note" with a clear path to a strict improvement.

- **No commits / no tests** per user override. Final typecheck is the only validation step.
