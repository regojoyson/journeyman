# Workspace Members Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-introduce an org-admin "Members" tab on the workspace detail page that lists associated users (paginated) and lets an admin associate a user, change their workspace role, and remove them — as UI + API only, with audited write operations.

**Architecture:** Five new routes in the existing `registerWorkspaceRoutes` (org-admin gated, write ops audited via the declarative `config.audit` hook) call existing + two new helpers in `db-workspaces.ts`. The `web` API client gains member methods; a new `MembersTab` React component renders the table, associate control, and pagination. `loadWorkspaceAccess` is **not** touched — access stays automatic, so there is no migration and no lockout risk.

**Tech Stack:** Fastify v5, `pg` (raw SQL, no ORM), TypeScript, Vitest (unit tests with a fake `Queryable`), React + react-router-dom, Tailwind via `admin-styles.ts`.

**Working agreement (per user):**
- **Branch:** work directly on `master`. Do **not** create a branch or worktree.
- **Commits:** do **not** commit. Leave all changes in the working tree.
- **Verification:** a single typecheck pass at the very end (Task 6). Run unit tests too, but no per-task commits.

**Spec:** [`docs/superpowers/specs/2026-06-21-workspace-members-tab-design.md`](../specs/2026-06-21-workspace-members-tab-design.md)

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/identity/src/db-workspaces.ts` | Add `listWorkspaceMembersPage` + `listAddableOrgMembers` | Modify |
| `packages/identity/src/db-workspaces.test.ts` | Unit tests for the two new helpers | Modify |
| `packages/identity/src/routes/workspaces.ts` | Add 5 member routes (3 audited) | Modify |
| `packages/web/src/api/workspaces.ts` | Add member API methods + types | Modify |
| `packages/web/src/routes/workspace-detail/MembersTab.tsx` | Members tab UI (table, associate, pagination) | Create |
| `packages/web/src/routes/WorkspaceDetailPage.tsx` | Add `{ to: "members", label: "Members" }` tab | Modify |
| `packages/web/src/App.tsx` | Add `<Route path="members" .../>` + import | Modify |

---

## Task 1: DB helpers — paginated members + addable org members

**Files:**
- Modify: `packages/identity/src/db-workspaces.ts`
- Test: `packages/identity/src/db-workspaces.test.ts`

The repo's DB tests use a fake `Queryable` that records `{ text, params }` and returns canned rows — no real database. Mirror that style (see existing tests in the same file).

- [ ] **Step 1: Write the failing tests**

Add these imports to the top `import { ... } from "./db-workspaces.ts";` block in `packages/identity/src/db-workspaces.test.ts`:

```typescript
  listWorkspaceMembersPage,
  listAddableOrgMembers,
```

Append these tests inside the `describe("workspace store", () => { ... })` block (before its closing `});`):

```typescript
  it("listWorkspaceMembersPage passes limit/offset and reads COUNT(*) OVER() as total", async () => {
    const db = fakeDb(() => ({
      rows: [
        { user_id: "u1", role: "maintainer", created_at: "2026-06-18T00:00:00Z", username: "amy", display_name: "Amy Ray", total: "2" },
        { user_id: "u2", role: "contributor", created_at: "2026-06-17T00:00:00Z", username: "ben", display_name: "Ben Lo", total: "2" },
      ],
    }));
    const res = await listWorkspaceMembersPage(db, "w1", { limit: 20, offset: 0 });
    expect(res.total).toBe(2);
    expect(res.items).toHaveLength(2);
    expect(res.items[0]).toEqual({
      userId: "u1", username: "amy", displayName: "Amy Ray", role: "maintainer",
      createdAt: new Date("2026-06-18T00:00:00Z"),
    });
    expect(db.calls[0].text).toMatch(/count\(\*\) over\(\)/i);
    expect(db.calls[0].text).toMatch(/where wm\.workspace_id = \$1/i);
    expect(db.calls[0].params).toEqual(["w1", 20, 0]);
  });

  it("listWorkspaceMembersPage returns total 0 for an empty workspace", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    const res = await listWorkspaceMembersPage(db, "w1", { limit: 20, offset: 40 });
    expect(res.total).toBe(0);
    expect(res.items).toEqual([]);
  });

  it("listAddableOrgMembers excludes existing members and orders by username", async () => {
    const db = fakeDb(() => ({ rows: [{ user_id: "u3", username: "cara", display_name: "Cara Wu" }] }));
    const rows = await listAddableOrgMembers(db, "o1", "w1");
    expect(rows).toEqual([{ userId: "u3", username: "cara", displayName: "Cara Wu" }]);
    expect(db.calls[0].text).toMatch(/not exists/i);
    expect(db.calls[0].text).toMatch(/order by u\.username asc/i);
    expect(db.calls[0].params).toEqual(["o1", "w1", null]);
  });

  it("listAddableOrgMembers passes the search term when provided", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    await listAddableOrgMembers(db, "o1", "w1", "ca");
    expect(db.calls[0].params).toEqual(["o1", "w1", "ca"]);
    expect(db.calls[0].text).toMatch(/ilike/i);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/identity && npx vitest run src/db-workspaces.test.ts`
Expected: FAIL — `listWorkspaceMembersPage is not a function` / `listAddableOrgMembers is not a function`.

- [ ] **Step 3: Implement the two helpers**

Append to `packages/identity/src/db-workspaces.ts` (after `updateWorkspaceMemberRole`):

```typescript
/** One page of workspace members joined to users, plus the total count. */
export async function listWorkspaceMembersPage(
  db: Queryable,
  workspaceId: string,
  page: { limit: number; offset: number },
): Promise<{
  items: Array<{ userId: string; username: string; displayName: string | null; role: WorkspaceRole; createdAt: Date }>;
  total: number;
}> {
  const r = await db.query(
    `SELECT wm.user_id, wm.role, wm.created_at, u.username, u.display_name,
            COUNT(*) OVER() AS total
       FROM jm_workspace_members wm
       JOIN jm_users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1
      ORDER BY u.username ASC
      LIMIT $2 OFFSET $3`,
    [workspaceId, page.limit, page.offset],
  );
  const total = r.rows[0] ? Number(r.rows[0].total) : 0;
  return {
    total,
    items: r.rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name ?? null,
      role: row.role as WorkspaceRole,
      createdAt: new Date(row.created_at),
    })),
  };
}

/** Org members who are NOT yet in the workspace, for the associate picker. Optional username/displayName search. */
export async function listAddableOrgMembers(
  db: Queryable,
  orgId: string,
  workspaceId: string,
  q?: string,
): Promise<Array<{ userId: string; username: string; displayName: string | null }>> {
  const term = q && q.trim() ? q.trim() : null;
  const r = await db.query(
    `SELECT u.id AS user_id, u.username, u.display_name
       FROM jm_memberships m
       JOIN jm_users u ON u.id = m.user_id
      WHERE m.org_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM jm_workspace_members wm
           WHERE wm.workspace_id = $2 AND wm.user_id = u.id
        )
        AND ($3::text IS NULL
             OR u.username ILIKE '%' || $3 || '%'
             OR u.display_name ILIKE '%' || $3 || '%')
      ORDER BY u.username ASC
      LIMIT 50`,
    [orgId, workspaceId, term],
  );
  return r.rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name ?? null,
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/identity && npx vitest run src/db-workspaces.test.ts`
Expected: PASS (all tests, including the 4 new ones).

---

## Task 2: Backend member routes (org-admin, audited writes)

**Files:**
- Modify: `packages/identity/src/routes/workspaces.ts`

All routes are org-admin gated (`requireAuth({ role: "admin" })`) and re-check `req.runContext!.org.id === orgId` + that the workspace belongs to the org, matching the existing routes in this file. Write ops carry a `config.audit` tag; the central `onResponse` hook persists the entry on 2xx.

- [ ] **Step 1: Extend the imports**

Replace the existing import block from `"../db-workspaces.ts"` (currently lines 5–12) with:

```typescript
import {
  listWorkspacesForOrg,
  slugifyWorkspaceName,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  updateWorkspace,
  upsertWorkspaceMember,
  getWorkspaceMember,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  listWorkspaceMembersPage,
  listAddableOrgMembers,
} from "../db-workspaces.ts";
import type { WorkspaceRole } from "@journeyman/core";
```

- [ ] **Step 2: Add a role guard constant**

Add directly below `const requireAuth = makeRequireAuth({ pool });` inside `registerWorkspaceRoutes`:

```typescript
  const WORKSPACE_ROLES: WorkspaceRole[] = ["maintainer", "contributor", "observer"];
  const isWorkspaceRole = (v: unknown): v is WorkspaceRole =>
    typeof v === "string" && (WORKSPACE_ROLES as string[]).includes(v);

  // Validates :orgId matches the caller's org and the workspace exists under it.
  async function loadOrgWorkspace(req: any, reply: any) {
    const { orgId, wsId } = req.params as { orgId: string; wsId: string };
    if (req.runContext!.org.id !== orgId) { reply.code(403).send({ error: "wrong_org" }); return null; }
    const ws = await getWorkspace(pool, wsId);
    if (!ws || ws.orgId !== orgId) { reply.code(404).send({ error: "not_found" }); return null; }
    return ws;
  }
```

- [ ] **Step 3: Add the 5 member routes**

Insert before the final closing `}` of `registerWorkspaceRoutes` (after the existing DELETE workspace route):

```typescript
  // --- Workspace members (org-admin only) ---

  // List members, paginated.
  app.get("/api/orgs/:orgId/workspaces/:wsId/members", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const ws = await loadOrgWorkspace(req, reply);
    if (!ws) return;
    const qs = req.query as { page?: string; limit?: string };
    const page = Math.max(1, Number(qs.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(qs.limit) || 20));
    const { items, total } = await listWorkspaceMembersPage(pool, ws.id, { limit, offset: (page - 1) * limit });
    return { items, total, page, limit };
  });

  // Org members not yet in the workspace, for the associate picker.
  app.get("/api/orgs/:orgId/workspaces/:wsId/addable-members", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const ws = await loadOrgWorkspace(req, reply);
    if (!ws) return;
    const { q } = req.query as { q?: string };
    return { items: await listAddableOrgMembers(pool, ws.orgId, ws.id, q) };
  });

  // Associate a user with a workspace role.
  app.post("/api/orgs/:orgId/workspaces/:wsId/members", {
    preHandler: requireAuth({ role: "admin" }),
    config: { audit: { action: "workspace.member.add", targetType: "workspace_member", idParam: "wsId" } },
  }, async (req, reply) => {
    const ws = await loadOrgWorkspace(req, reply);
    if (!ws) return;
    const body = req.body as { userId?: string; role?: string };
    if (!body?.userId) return reply.code(400).send({ error: "missing_user" });
    if (!isWorkspaceRole(body.role)) return reply.code(400).send({ error: "invalid_role" });
    const inOrg = await pool.query("SELECT 1 FROM jm_memberships WHERE org_id = $1 AND user_id = $2", [ws.orgId, body.userId]);
    if (inOrg.rowCount === 0) return reply.code(400).send({ error: "not_org_member" });
    const rec = await upsertWorkspaceMember(pool, { workspaceId: ws.id, userId: body.userId, role: body.role });
    req.auditDetail = { userId: body.userId, role: body.role };
    reply.code(201);
    return { userId: rec.userId, role: rec.role };
  });

  // Update a member's workspace role.
  app.patch("/api/orgs/:orgId/workspaces/:wsId/members/:userId", {
    preHandler: requireAuth({ role: "admin" }),
    config: { audit: { action: "workspace.member.update_role", targetType: "workspace_member", idParam: "userId" } },
  }, async (req, reply) => {
    const ws = await loadOrgWorkspace(req, reply);
    if (!ws) return;
    const { userId } = req.params as { userId: string };
    const body = req.body as { role?: string };
    if (!isWorkspaceRole(body?.role)) return reply.code(400).send({ error: "invalid_role" });
    const existing = await getWorkspaceMember(pool, ws.id, userId);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    await updateWorkspaceMemberRole(pool, ws.id, userId, body.role);
    req.auditDetail = { role: body.role };
    return { ok: true };
  });

  // Remove a member.
  app.delete("/api/orgs/:orgId/workspaces/:wsId/members/:userId", {
    preHandler: requireAuth({ role: "admin" }),
    config: { audit: { action: "workspace.member.remove", targetType: "workspace_member", idParam: "userId" } },
  }, async (req, reply) => {
    const ws = await loadOrgWorkspace(req, reply);
    if (!ws) return;
    const { userId } = req.params as { userId: string };
    await removeWorkspaceMember(pool, ws.id, userId);
    return { ok: true };
  });
```

- [ ] **Step 4: Typecheck this package**

Run: `cd packages/identity && npx tsc --noEmit`
Expected: no errors. (Confirms imports, the `audit` config shape, and `WorkspaceRole` usage all line up.)

---

## Task 3: Web API client — member methods + types

**Files:**
- Modify: `packages/web/src/api/workspaces.ts`

- [ ] **Step 1: Add the member types**

Add after the `WorkspaceDetail` interface (line 18):

```typescript
export interface WorkspaceMember {
  userId: string;
  username: string;
  displayName: string | null;
  role: WorkspaceRole;
  createdAt: string;
}
export interface AddableMember {
  userId: string;
  username: string;
  displayName: string | null;
}
export interface WorkspaceMembersPage {
  items: WorkspaceMember[];
  total: number;
  page: number;
  limit: number;
}
```

- [ ] **Step 2: Add the methods to `workspaceAdminApi`**

Insert these properties inside the `workspaceAdminApi` object (after `update`, before the closing `};`). Note the leading comma after the existing `update` entry:

```typescript
  listMembers: (orgId: string, wsId: string, opts: { page: number; limit: number }) =>
    api<WorkspaceMembersPage>(
      `/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}/members` +
        `?page=${opts.page}&limit=${opts.limit}`,
    ),
  listAddableMembers: (orgId: string, wsId: string, q: string) =>
    api<{ items: AddableMember[] }>(
      `/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}/addable-members` +
        `?q=${encodeURIComponent(q)}`,
    ).then((r) => r.items),
  addMember: (orgId: string, wsId: string, body: { userId: string; role: WorkspaceRole }) =>
    api<{ userId: string; role: WorkspaceRole }>(
      `/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}/members`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  setMemberRole: (orgId: string, wsId: string, userId: string, role: WorkspaceRole) =>
    api<{ ok: true }>(
      `/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    ),
  removeMember: (orgId: string, wsId: string, userId: string) =>
    api<{ ok: true }>(
      `/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ),
```

`WorkspaceRole` is already imported at the top of this file (line 2). No new import needed.

---

## Task 4: MembersTab component

**Files:**
- Create: `packages/web/src/routes/workspace-detail/MembersTab.tsx`

Modeled on `SettingsTab.tsx` (same outlet-context + `admin-styles` patterns). Role change saves instantly; remove asks for a confirm; associate uses a debounced search over addable org members.

- [ ] **Step 1: Create the component**

Create `packages/web/src/routes/workspace-detail/MembersTab.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceRole } from "@journeyman/core";
import {
  workspaceAdminApi,
  type AddableMember,
  type WorkspaceMember,
} from "../../api/workspaces.ts";
import { btnDanger, btnPrimary, card, inputCls, selectCls } from "../admin-styles.ts";
import type { WorkspaceDetailContext } from "../WorkspaceDetailPage.tsx";

const ROLES: WorkspaceRole[] = ["maintainer", "contributor", "observer"];
const LIMIT = 20;

function initials(m: { username: string; displayName: string | null }): string {
  const base = m.displayName || m.username;
  return base.slice(0, 2).toUpperCase();
}

export function MembersTab() {
  const { orgId, wsId } = useOutletContext<WorkspaceDetailContext>();

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<AddableMember[]>([]);
  const [selected, setSelected] = useState<AddableMember | null>(null);
  const [addRole, setAddRole] = useState<WorkspaceRole>("contributor");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (p: number) => {
    setError(null);
    try {
      const res = await workspaceAdminApi.listMembers(orgId, wsId, { page: p, limit: LIMIT });
      setMembers(res.items);
      setTotal(res.total);
      setPage(res.page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load members.");
    }
  }, [orgId, wsId]);

  useEffect(() => { void load(1); }, [load]);

  // Debounced addable-members search.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        setCandidates(await workspaceAdminApi.listAddableMembers(orgId, wsId, query));
      } catch {
        setCandidates([]);
      }
    }, 250);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, orgId, wsId, members]);

  async function add() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await workspaceAdminApi.addMember(orgId, wsId, { userId: selected.userId, role: addRole });
      setSelected(null);
      setQuery("");
      await load(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add member.");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, role: WorkspaceRole) {
    setError(null);
    try {
      await workspaceAdminApi.setMemberRole(orgId, wsId, userId, role);
      setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, role } : m)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update role.");
      await load(page);
    }
  }

  async function remove(userId: string) {
    setBusy(true);
    setError(null);
    try {
      await workspaceAdminApi.removeMember(orgId, wsId, userId);
      setConfirmRemove(null);
      const lastOnPage = members.length === 1 && page > 1;
      await load(lastOnPage ? page - 1 : page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove member.");
    } finally {
      setBusy(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="space-y-8">
      <section className={`${card} p-6`}>
        <h2 className="text-base font-medium text-slate-100 mb-4">Associate a user</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">User</label>
            <input
              className={inputCls}
              value={selected ? (selected.displayName || selected.username) : query}
              placeholder="Search org members…"
              onChange={(e) => { setSelected(null); setQuery(e.target.value); }}
            />
            {!selected && query && candidates.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-md border bg-card shadow-card">
                {candidates.map((c) => (
                  <button
                    key={c.userId}
                    type="button"
                    onClick={() => { setSelected(c); setQuery(""); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs">{initials(c)}</span>
                    <span>
                      <span className="block text-slate-100">{c.username}</span>
                      {c.displayName && <span className="block text-xs text-muted-foreground">{c.displayName}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {!selected && query && candidates.length === 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground shadow-card">
                No matching org members.
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Role</label>
            <select className={selectCls} value={addRole} onChange={(e) => setAddRole(e.target.value as WorkspaceRole)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button type="button" onClick={add} disabled={!selected || busy} className={btnPrimary}>
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </section>

      <section className={`${card} p-0 overflow-hidden`}>
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className="text-base font-medium text-slate-100">Members <span className="text-slate-500 font-normal">· {total}</span></h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t text-left text-muted-foreground">
              <th className="px-6 py-2 font-medium">User</th>
              <th className="px-6 py-2 font-medium">Workspace role</th>
              <th className="px-6 py-2 font-medium">Added</th>
              <th className="px-6 py-2" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-t">
                <td className="px-6 py-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs">{initials(m)}</span>
                    <span>
                      <span className="block text-slate-100">{m.username}</span>
                      {m.displayName && <span className="block text-xs text-muted-foreground">{m.displayName}</span>}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-3">
                  <select
                    className={selectCls}
                    value={m.role}
                    onChange={(e) => changeRole(m.userId, e.target.value as WorkspaceRole)}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-6 py-3 text-muted-foreground">{new Date(m.createdAt).toLocaleDateString()}</td>
                <td className="px-6 py-3 text-right">
                  {confirmRemove === m.userId ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Remove?</span>
                      <button onClick={() => remove(m.userId)} disabled={busy} className={btnDanger}>Confirm</button>
                      <button onClick={() => setConfirmRemove(null)} className={btnDanger}>Cancel</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmRemove(m.userId)} className={btnDanger}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr className="border-t"><td colSpan={4} className="px-6 py-6 text-center text-muted-foreground">No members yet.</td></tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-6 py-4 border-t">
          <span className="text-sm text-muted-foreground">
            {total === 0 ? "No members" : `Showing ${(page - 1) * LIMIT + 1}–${Math.min(page * LIMIT, total)} of ${total}`}
          </span>
          <span className="flex items-center gap-2">
            <button onClick={() => load(page - 1)} disabled={page <= 1} className={btnDanger}>Prev</button>
            <span className="text-sm text-muted-foreground">Page {page} of {pageCount}</span>
            <button onClick={() => load(page + 1)} disabled={page >= pageCount} className={btnDanger}>Next</button>
          </span>
        </div>
      </section>

      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}
```

*Note: `btnDanger` is reused for the small ghost-style Prev/Next/Cancel controls to avoid adding new style variants; if a neutral small-button variant is preferred, use `btnGhost` from `admin-styles.ts` instead — both already exist. Keep it consistent with whatever the reviewer prefers, but do not invent a new class.*

---

## Task 5: Register the tab + route

**Files:**
- Modify: `packages/web/src/routes/WorkspaceDetailPage.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Add the tab entry**

In `packages/web/src/routes/WorkspaceDetailPage.tsx`, change the `TABS` array (lines 13–16) to:

```typescript
const TABS = [
  { to: "overview", label: "Overview" },
  { to: "members", label: "Members" },
  { to: "settings", label: "Settings" },
];
```

- [ ] **Step 2: Import MembersTab in App.tsx**

In `packages/web/src/App.tsx`, add after the `SettingsTab` import (line 28):

```typescript
import { MembersTab } from "./routes/workspace-detail/MembersTab.tsx";
```

- [ ] **Step 3: Add the nested route**

In `packages/web/src/App.tsx`, inside the `/orgs/:orgId/workspaces/:wsId` route block, add the members route between `overview` and `settings` (around lines 88–89):

```tsx
          <Route path="overview" element={<OverviewTab />} />
          <Route path="members" element={<MembersTab />} />
          <Route path="settings" element={<SettingsTab />} />
```

---

## Task 6: Final verification (typecheck + tests)

**No commits.** Leave all changes in the working tree on `master`.

- [ ] **Step 1: Run the identity unit tests**

Run: `cd packages/identity && npx vitest run src/db-workspaces.test.ts`
Expected: PASS (existing tests + the 4 new helper tests).

- [ ] **Step 2: Typecheck + import boundaries from the repo root**

Run: `cd /Users/admin/data/workspace/claude-skils/journeyman && npm run check`
Expected: typecheck passes for all packages (notably `@journeyman/identity` and `@journeyman/web`) and `npm run check:boundaries` reports no violations.

- [ ] **Step 3: If anything fails, fix inline and re-run Step 2**

Do not commit. Report the final `npm run check` result to the user.

---

## Self-Review Notes

- **Spec coverage:** paginated list (Task 1 `listWorkspaceMembersPage` + Task 2 GET members + Task 4 pagination UI); associate via addable picker (Task 1 `listAddableOrgMembers` + Task 2 addable + POST + Task 4 search/add); update role (Task 2 PATCH + Task 4 inline select); remove (Task 2 DELETE + Task 4 confirm); audit on the 3 writes (Task 2 `config.audit` tags); org-admin gating (Task 2 `requireAuth({ role: "admin" })`); access semantics untouched (no edit to `authz.ts` anywhere in the plan). ✓
- **Non-org-user rejection:** Task 2 POST checks `jm_memberships` before upsert. ✓
- **Type consistency:** `WorkspaceMember` / `AddableMember` shapes match the DB helper return shapes (Task 1) and the route responses (Task 2); `WorkspaceRole` used uniformly; method names `listMembers`/`listAddableMembers`/`addMember`/`setMemberRole`/`removeMember` consistent between Task 3 (client) and Task 4 (consumer). ✓
- **No migration / no authz change:** confirmed absent from the file list. ✓
