# Workspace detail page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an org-admin workspace detail page at `/orgs/:orgId/workspaces/:wsId` with Overview / Members / Settings tabs, folding the standalone workspace-members page into the Members tab and adding workspace rename/slug editing.

**Architecture:** A new org-scoped detail route (gated by org admin / super admin, same as the workspaces list) renders a header + left sub-nav and nested tab routes. The existing member-management UI is extracted into a reusable `WorkspaceMembersPanel` driven by `orgId`/`wsId` props (no `WorkspaceContext` dependency). Two new org-admin backend endpoints (`GET` one workspace, `PATCH` rename/slug) back the page; everything else reuses existing endpoints.

**Tech Stack:** Fastify + `pg` (no ORM) on the backend; React + react-router v6 + Tailwind on the frontend; Vitest for tests.

**Plan-specific constraints (from the requester):**
- Work directly on the `master` branch.
- **No commits** — leave all changes in the working tree.
- **No per-task commit/typecheck steps.** A single typecheck + unit-test pass runs once at the very end (Task 8). The only mid-plan test run is the TDD cycle for the new DB function (Task 1), which has an established Vitest harness.

**Styling note:** The visual mockup approved during brainstorming conveys *structure* (header band, left sub-nav, members table). Implement using the app's existing conventions — Tailwind utility classes and the helpers in `packages/web/src/routes/admin-styles.ts` (`card`, `selectCls`, `inputCls`, `btnPrimary`, `btnDanger`, `btnGhost`, `codePill`) — not the brainstorming design system.

---

## File structure

**Backend (`packages/identity`)**
- Modify: `packages/identity/src/db-workspaces.ts` — add `updateWorkspace()`.
- Modify: `packages/identity/src/db-workspaces.test.ts` — unit test for `updateWorkspace()`.
- Modify: `packages/identity/src/routes/workspaces.ts` — add `GET` + `PATCH` org-scoped single-workspace routes.

**Frontend (`packages/web`)**
- Modify: `packages/web/src/api/workspaces.ts` — add `getOne` + `update` to `workspaceAdminApi`; add `WorkspaceDetail` type.
- Create: `packages/web/src/components/WorkspaceMembersPanel.tsx` — extracted member-management UI (props `orgId`, `wsId`).
- Create: `packages/web/src/routes/WorkspaceDetailPage.tsx` — detail layout: header + left sub-nav + `<Outlet>`.
- Create: `packages/web/src/routes/workspace-detail/OverviewTab.tsx`
- Create: `packages/web/src/routes/workspace-detail/MembersTab.tsx`
- Create: `packages/web/src/routes/workspace-detail/SettingsTab.tsx`
- Modify: `packages/web/src/App.tsx` — add nested detail routes; remove the standalone members route + import.
- Modify: `packages/web/src/routes/OrgWorkspacesPage.tsx` — make rows navigate to the detail page; remove the per-row delete action + delete modal (delete now lives in the Settings Danger Zone).
- Modify: `packages/web/src/components/Sidebar.tsx` — remove the standalone "Members" nav link (route no longer exists).
- Delete: `packages/web/src/routes/WorkspaceMembersPage.tsx` — replaced by the panel + Members tab.

---

## Task 1: Backend — `updateWorkspace` DB helper (TDD)

**Files:**
- Modify: `packages/identity/src/db-workspaces.ts`
- Test: `packages/identity/src/db-workspaces.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/identity/src/db-workspaces.test.ts` (it already imports from `./db-workspaces.ts`, defines `fakeDb`, and has `WS_ROW`). Add `updateWorkspace` to the existing import block, then add this test inside the `describe("workspace store", …)` block:

```ts
  it("updateWorkspace updates name/slug and maps row->record", async () => {
    const db = fakeDb(() => ({ rows: [{ ...WS_ROW, name: "Renamed", slug: "renamed" }] }));
    const rec = await updateWorkspace(db, { workspaceId: "w1", orgId: "o1", name: "Renamed", slug: "renamed" });
    expect(rec?.name).toBe("Renamed");
    expect(rec?.slug).toBe("renamed");
    expect((db as any).calls[0].text).toContain("UPDATE jm_workspaces");
    expect((db as any).calls[0].params).toEqual(["w1", "o1", "Renamed", "renamed"]);
  });

  it("updateWorkspace returns null when no row matches", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    const rec = await updateWorkspace(db, { workspaceId: "missing", orgId: "o1", name: "X", slug: "x" });
    expect(rec).toBeNull();
  });
```

Update the import at the top of the file to include `updateWorkspace`:

```ts
import {
  createWorkspace,
  getWorkspace,
  listWorkspacesForOrg,
  upsertWorkspaceMember,
  getWorkspaceMember,
  listWorkspaceMembers,
  updateWorkspace,
} from "./db-workspaces.ts";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/identity -- db-workspaces`
Expected: FAIL — `updateWorkspace is not a function` / `not exported`.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/identity/src/db-workspaces.ts` (after `deleteWorkspace`, near the other workspace CRUD helpers). It reuses the existing `rowToWorkspace` mapper and `Queryable` type already defined in this file:

```ts
export async function updateWorkspace(
  db: Queryable,
  input: { workspaceId: string; orgId: string; name: string; slug: string },
): Promise<WorkspaceRecord | null> {
  const r = await db.query(
    `UPDATE jm_workspaces
        SET name = $3, slug = $4, updated_at = now()
      WHERE id = $1 AND org_id = $2
      RETURNING id, org_id, slug, name, created_at, updated_at`,
    [input.workspaceId, input.orgId, input.name, input.slug],
  );
  return r.rows[0] ? rowToWorkspace(r.rows[0]) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/identity -- db-workspaces`
Expected: PASS (all tests in the file, including the two new ones).

---

## Task 2: Backend — `GET` and `PATCH` single-workspace routes

**Files:**
- Modify: `packages/identity/src/routes/workspaces.ts`

No HTTP-route integration-test harness exists in this package (only DB-layer unit tests via `fakeDb`), so this task is verified by the final typecheck (Task 8). The DB layer it calls is already tested in Task 1.

- [ ] **Step 1: Import `updateWorkspace`**

In `packages/identity/src/routes/workspaces.ts`, add `updateWorkspace` to the existing import from `../db-workspaces.ts`:

```ts
import {
  listWorkspacesForUser,
  listWorkspacesForOrg,
  listWorkspaceMembersWithUsers,
  slugifyWorkspaceName,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  getWorkspaceMember,
  upsertWorkspaceMember,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  updateWorkspace,
} from "../db-workspaces.ts";
```

- [ ] **Step 2: Add the `GET` one + `PATCH` routes**

Insert both routes immediately **after** the existing `app.post("/api/orgs/:orgId/workspaces", …)` block and **before** the `app.delete("/api/orgs/:orgId/workspaces/:wsId", …)` block (so all org-scoped workspace routes stay grouped). They mirror the guard + `wrong_org` + `not_found` + `23505→409` patterns already used in this file:

```ts
  app.get("/api/orgs/:orgId/workspaces/:wsId", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId, wsId } = req.params as { orgId: string; wsId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });
    const ws = await getWorkspace(pool, wsId);
    if (!ws || ws.orgId !== orgId) return reply.code(404).send({ error: "not_found" });
    return ws;
  });

  app.patch("/api/orgs/:orgId/workspaces/:wsId", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId, wsId } = req.params as { orgId: string; wsId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });
    const body = req.body as { name?: string; slug?: string };
    if (!body?.name?.trim()) return reply.code(400).send({ error: "missing_name" });
    const existing = await getWorkspace(pool, wsId);
    if (!existing || existing.orgId !== orgId) return reply.code(404).send({ error: "not_found" });
    const slug = body.slug?.trim() || slugifyWorkspaceName(body.name);
    try {
      const ws = await updateWorkspace(pool, { workspaceId: wsId, orgId, name: body.name.trim(), slug });
      if (!ws) return reply.code(404).send({ error: "not_found" });
      return ws;
    } catch (err: any) {
      if (err?.code === "23505") return reply.code(409).send({ error: "slug_exists" });
      throw err;
    }
  });
```

---

## Task 3: Frontend — API client additions

**Files:**
- Modify: `packages/web/src/api/workspaces.ts`

- [ ] **Step 1: Add the `WorkspaceDetail` type**

In `packages/web/src/api/workspaces.ts`, add below the existing `OrgWorkspace` interface (~line 17). The backend serializes a `WorkspaceRecord`, whose `orgId` and `createdAt` are camelCase (the `rowToWorkspace` mapper produces them); `createdAt` arrives as an ISO string over the wire:

```ts
export interface WorkspaceDetail {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  createdAt: string;
}
```

- [ ] **Step 2: Add `getOne` and `update` to `workspaceAdminApi`**

In the `workspaceAdminApi` object, add these two members after `remove` (keep the existing members unchanged):

```ts
  getOne: (orgId: string, wsId: string) =>
    api<WorkspaceDetail>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}`),
  update: (orgId: string, wsId: string, body: { name: string; slug?: string }) =>
    api<WorkspaceDetail>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
```

---

## Task 4: Frontend — extract `WorkspaceMembersPanel`

**Files:**
- Create: `packages/web/src/components/WorkspaceMembersPanel.tsx`

This is the body of the current `WorkspaceMembersPage`, parameterized by `orgId`/`wsId` props with the `WorkspaceContext`/`can`/`useParams` dependencies removed (access is gated by the detail page). It renders only the two cards (no outer page header/scroll wrapper — the detail layout provides those).

- [ ] **Step 1: Create the panel**

Create `packages/web/src/components/WorkspaceMembersPanel.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import type { WorkspaceRole } from "@journeyman/core";
import {
  workspaceAdminApi,
  listOrgUsers,
  type WorkspaceMember,
  type OrgUser,
} from "../api/workspaces.ts";
import { btnDanger, btnPrimary, card, selectCls } from "../routes/admin-styles.ts";

const ROLES: WorkspaceRole[] = ["maintainer", "contributor", "observer"];

export function WorkspaceMembersPanel({ orgId, wsId }: { orgId: string; wsId: string }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<WorkspaceRole>("contributor");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await workspaceAdminApi.listMembers(wsId);
      setMembers(m);
      if (orgId) setOrgUsers(await listOrgUsers(orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load members.");
    } finally {
      setLoading(false);
    }
  }, [wsId, orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const memberIds = new Set(members.map((m) => m.userId));
  const addable = orgUsers.filter((u) => !memberIds.has(u.id));

  async function setRole(userId: string, role: WorkspaceRole) {
    setError(null);
    try {
      await workspaceAdminApi.setMemberRole(wsId, userId, role);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update role.");
    }
  }

  async function remove(userId: string, username: string) {
    if (!confirm(`Remove ${username} from this workspace?`)) return;
    setError(null);
    try {
      await workspaceAdminApi.removeMember(wsId, userId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove member.");
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!addUserId) return;
    setError(null);
    setBusy(true);
    try {
      await workspaceAdminApi.addMember(wsId, { userId: addUserId, role: addRole });
      setAddUserId("");
      setAddRole("contributor");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className={`${card} p-6`}>
        <h2 className="text-base font-medium text-slate-100 mb-4">Add a member</h2>
        {addable.length === 0 ? (
          <p className="text-sm text-slate-500">All org users are already members.</p>
        ) : (
          <form onSubmit={add} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">User</label>
              <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className={selectCls} required>
                <option value="">Select a user…</option>
                {addable.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username}{u.displayName ? ` (${u.displayName})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Role</label>
              <select value={addRole} onChange={(e) => setAddRole(e.target.value as WorkspaceRole)} className={selectCls}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <button type="submit" disabled={busy || !addUserId} className={btnPrimary}>
              {busy ? "Adding…" : "Add member"}
            </button>
          </form>
        )}
        {error && <div className="mt-4 text-sm text-destructive">{error}</div>}
      </section>

      <section className={`${card} overflow-hidden`}>
        <div className="px-6 py-4 border-b border-slate-700">
          <h2 className="text-base font-medium text-slate-100">
            Members <span className="text-slate-500 font-normal">({members.length})</span>
          </h2>
        </div>
        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
        ) : members.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No members yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-subtle text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-6 py-3">Username</th>
                <th className="text-left font-medium px-6 py-3">Role</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700 border-t border-slate-700">
              {members.map((m) => (
                <tr key={m.userId} className="hover:bg-surface-hover">
                  <td className="px-6 py-3">
                    <div className="text-slate-100 font-medium">{m.username}</div>
                    {m.displayName && <div className="text-xs text-slate-500">{m.displayName}</div>}
                  </td>
                  <td className="px-6 py-3">
                    <select value={m.role} onChange={(e) => setRole(m.userId, e.target.value as WorkspaceRole)} className={selectCls}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end">
                      <button onClick={() => remove(m.userId, m.username)} className={btnDanger}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
```

---

## Task 5: Frontend — detail page layout + tab components

**Files:**
- Create: `packages/web/src/routes/WorkspaceDetailPage.tsx`
- Create: `packages/web/src/routes/workspace-detail/OverviewTab.tsx`
- Create: `packages/web/src/routes/workspace-detail/MembersTab.tsx`
- Create: `packages/web/src/routes/workspace-detail/SettingsTab.tsx`

The detail page fetches the workspace once and shares it (plus `orgId`/`wsId` and a `refresh` callback) with the tab children via react-router's `Outlet` context.

- [ ] **Step 1: Create the detail layout**

Create `packages/web/src/routes/WorkspaceDetailPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { workspaceAdminApi, type WorkspaceDetail } from "../api/workspaces.ts";
import { card, codePill } from "./admin-styles.ts";

export interface WorkspaceDetailContext {
  orgId: string;
  wsId: string;
  workspace: WorkspaceDetail;
  refresh: () => Promise<void>;
}

const TABS = [
  { to: "overview", label: "Overview" },
  { to: "members", label: "Members" },
  { to: "settings", label: "Settings" },
];

export function WorkspaceDetailPage() {
  const { orgId = "", wsId = "" } = useParams<{ orgId: string; wsId: string }>();
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWorkspace(await workspaceAdminApi.getOne(orgId, wsId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workspace.");
    } finally {
      setLoading(false);
    }
  }, [orgId, wsId]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header>
          <NavLink to={`/orgs/${orgId}/workspaces`} className="text-sm text-slate-400 hover:text-slate-200">
            ← Workspaces
          </NavLink>
          {loading ? (
            <h1 className="mt-2 text-2xl font-semibold text-slate-100">Loading…</h1>
          ) : workspace ? (
            <div className="mt-2 flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-slate-100">{workspace.name}</h1>
              <span className={codePill}>{workspace.slug}</span>
            </div>
          ) : (
            <h1 className="mt-2 text-2xl font-semibold text-slate-100">Workspace not found</h1>
          )}
          {error && <div className="mt-2 text-sm text-destructive">{error}</div>}
        </header>

        {workspace && (
          <div className="flex gap-8">
            <nav className="w-48 shrink-0 flex flex-col gap-1">
              {TABS.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  className={({ isActive }) =>
                    `px-3 py-2 rounded text-sm ${isActive ? "bg-surface-hover text-slate-100 font-medium" : "text-slate-400 hover:text-slate-200"}`
                  }
                >
                  {t.label}
                </NavLink>
              ))}
            </nav>
            <div className="flex-1 min-w-0">
              <Outlet context={{ orgId, wsId, workspace, refresh } satisfies WorkspaceDetailContext} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the Overview tab**

Create `packages/web/src/routes/workspace-detail/OverviewTab.tsx`. It reads the shared workspace and loads the member count:

```tsx
import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { workspaceAdminApi } from "../../api/workspaces.ts";
import { card } from "../admin-styles.ts";
import type { WorkspaceDetailContext } from "../WorkspaceDetailPage.tsx";

export function OverviewTab() {
  const { wsId, workspace } = useOutletContext<WorkspaceDetailContext>();
  const [memberCount, setMemberCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void workspaceAdminApi.listMembers(wsId).then((m) => { if (active) setMemberCount(m.length); }).catch(() => {});
    return () => { active = false; };
  }, [wsId]);

  const created = new Date(workspace.createdAt).toLocaleDateString();

  return (
    <section className={`${card} p-6`}>
      <h2 className="text-base font-medium text-slate-100 mb-4">Overview</h2>
      <dl className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
        <dt className="text-slate-500">Name</dt><dd className="text-slate-200">{workspace.name}</dd>
        <dt className="text-slate-500">Slug</dt><dd className="text-slate-200">{workspace.slug}</dd>
        <dt className="text-slate-500">Created</dt><dd className="text-slate-200">{created}</dd>
        <dt className="text-slate-500">Members</dt><dd className="text-slate-200">{memberCount ?? "…"}</dd>
      </dl>
    </section>
  );
}
```

- [ ] **Step 3: Create the Members tab**

Create `packages/web/src/routes/workspace-detail/MembersTab.tsx`:

```tsx
import { useOutletContext } from "react-router-dom";
import { WorkspaceMembersPanel } from "../../components/WorkspaceMembersPanel.tsx";
import type { WorkspaceDetailContext } from "../WorkspaceDetailPage.tsx";

export function MembersTab() {
  const { orgId, wsId } = useOutletContext<WorkspaceDetailContext>();
  return <WorkspaceMembersPanel orgId={orgId} wsId={wsId} />;
}
```

- [ ] **Step 4: Create the Settings tab**

Create `packages/web/src/routes/workspace-detail/SettingsTab.tsx`. Rename/slug form (PATCH) plus a Danger Zone delete that reuses the type-the-name confirm pattern from `OrgWorkspacesPage`. Delete is disabled for the `default` workspace; on success it navigates back to the workspaces list:

```tsx
import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { ApiError } from "../../api/client.ts";
import { workspaceAdminApi } from "../../api/workspaces.ts";
import { btnDanger, btnGhost, btnPrimary, card, codePill, inputCls } from "../admin-styles.ts";
import type { WorkspaceDetailContext } from "../WorkspaceDetailPage.tsx";

export function SettingsTab() {
  const { orgId, wsId, workspace, refresh } = useOutletContext<WorkspaceDetailContext>();
  const navigate = useNavigate();
  const isDefault = workspace.slug === "default";

  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await workspaceAdminApi.update(orgId, wsId, { name, slug: slug.trim() || undefined });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError("A workspace with that slug already exists.");
      else setError(err instanceof Error ? err.message : "Failed to save workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      await workspaceAdminApi.remove(orgId, wsId);
      navigate(`/orgs/${orgId}/workspaces`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError("The default workspace can't be deleted.");
      else setError(err instanceof Error ? err.message : "Failed to delete workspace.");
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className={`${card} p-6`}>
        <h2 className="text-base font-medium text-slate-100 mb-4">Settings</h2>
        <form onSubmit={save} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Name</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Slug</label>
            <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Saving…" : "Save"}</button>
        </form>
        {error && !confirming && <div className="mt-4 text-sm text-destructive">{error}</div>}
      </section>

      <section className={`${card} p-6 border border-red-900/50`}>
        <h2 className="text-base font-medium text-destructive mb-2">Danger zone</h2>
        <p className="text-sm text-slate-400 mb-4">
          Deleting a workspace permanently removes ALL flows, agents, secrets, connections, MCPs, skills, custom steps,
          and webhooks in it. This cannot be undone.
        </p>
        {!confirming ? (
          <button
            onClick={() => { setConfirming(true); setConfirmName(""); setError(null); }}
            disabled={isDefault}
            title={isDefault ? "The default workspace can't be deleted." : undefined}
            className={btnDanger + (isDefault ? " opacity-50 cursor-not-allowed" : "")}
          >
            Delete workspace
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">Type <span className={codePill}>{workspace.name}</span> to confirm.</p>
            <input className={inputCls} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={workspace.name} autoFocus />
            {error && <div className="text-sm text-destructive">{error}</div>}
            <div className="flex gap-2">
              <button onClick={() => setConfirming(false)} disabled={busy} className={btnGhost}>Cancel</button>
              <button
                onClick={confirmDelete}
                disabled={busy || confirmName !== workspace.name}
                className={btnDanger + (busy || confirmName !== workspace.name ? " opacity-50 cursor-not-allowed" : "")}
              >
                {busy ? "Deleting…" : "Delete workspace"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
```

---

## Task 6: Frontend — wire routes, update list page, clean up nav

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/routes/OrgWorkspacesPage.tsx`
- Modify: `packages/web/src/components/Sidebar.tsx`
- Delete: `packages/web/src/routes/WorkspaceMembersPage.tsx`

- [ ] **Step 1: Update `App.tsx` imports**

In `packages/web/src/App.tsx`, remove the `WorkspaceMembersPage` import line:

```tsx
import { WorkspaceMembersPage } from "./routes/WorkspaceMembersPage.tsx";
```

and add:

```tsx
import { WorkspaceDetailPage } from "./routes/WorkspaceDetailPage.tsx";
import { OverviewTab } from "./routes/workspace-detail/OverviewTab.tsx";
import { MembersTab } from "./routes/workspace-detail/MembersTab.tsx";
import { SettingsTab } from "./routes/workspace-detail/SettingsTab.tsx";
import { Navigate } from "react-router-dom"; // already imported alongside Routes/Route — skip if present
```

(`Navigate` is already imported at the top of `App.tsx`; do not duplicate it.)

- [ ] **Step 2: Remove the standalone members route, add the nested detail routes**

In `packages/web/src/App.tsx`, delete this line:

```tsx
        <Route path="/workspaces/:wsId/members" element={<WorkspaceMembersPage />} />
```

Then, immediately after the existing `/orgs/:orgId/workspaces` route, add the nested detail route group:

```tsx
        <Route
          path="/orgs/:orgId/workspaces/:wsId"
          element={isAdmin ? <WorkspaceDetailPage /> : <Navigate to="/" replace />}
        >
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewTab />} />
          <Route path="members" element={<MembersTab />} />
          <Route path="settings" element={<SettingsTab />} />
        </Route>
```

- [ ] **Step 3: Make `OrgWorkspacesPage` rows navigate to the detail page; remove inline delete**

In `packages/web/src/routes/OrgWorkspacesPage.tsx`:

(a) Update imports — add `useNavigate`, and drop `btnDanger`/`btnGhost` from the `admin-styles` import (no longer used here):

```tsx
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client.ts";
import { workspaceAdminApi, type OrgWorkspace } from "../api/workspaces.ts";
import { btnPrimary, card, codePill, inputCls } from "./admin-styles.ts";
```

(b) Add the navigate hook at the top of the component and delete the delete-modal state + `openDelete`/`confirmDelete` functions:

```tsx
  const { orgId = "" } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
```

Remove these now-unused pieces entirely: the `target`/`confirmName` state (the two `useState` lines with the `// Delete confirm modal state.` comment), the `openDelete` function, the `confirmDelete` function, and the whole `{target && ( … )}` modal block at the bottom of the JSX.

(c) Replace the table body row markup so the row navigates and the delete cell is gone. Replace the entire `{workspaces.map((ws) => { … })}` block with:

```tsx
                {workspaces.map((ws) => (
                  <tr
                    key={ws.id}
                    onClick={() => navigate(`/orgs/${orgId}/workspaces/${ws.id}`)}
                    className="hover:bg-surface-hover cursor-pointer"
                  >
                    <td className="px-6 py-3 text-slate-100 font-medium">{ws.name}</td>
                    <td className="px-6 py-3"><span className={codePill}>{ws.slug}</span></td>
                    <td className="px-6 py-3 text-right text-slate-500">→</td>
                  </tr>
                ))}
```

(d) The `error && !target` guard in the create-form section references the removed `target`. Change it to just `error`:

```tsx
          {error && (
            <div className="mt-4 text-sm text-destructive">{error}</div>
          )}
```

- [ ] **Step 4: Remove the standalone "Members" link from the sidebar**

In `packages/web/src/components/Sidebar.tsx`, delete the members `NavLink` block (the `{activeWorkspaceId && can("members.manage") && ( … )}` block, lines ~168–175). Member management is now reached via Organization → Workspaces → (workspace) → Members tab.

If, after removing it, `can` is no longer referenced anywhere in `Sidebar.tsx`, also remove `can` from the `useWorkspace()` destructure to avoid an unused-variable error. (Check first — leave it if still used.)

- [ ] **Step 5: Delete the obsolete page**

```bash
rm packages/web/src/routes/WorkspaceMembersPage.tsx
```

---

## Task 7: Self-check the wiring (no commit)

- [ ] **Step 1: Grep for dangling references**

Run: `grep -rn "WorkspaceMembersPage\|/workspaces/:wsId/members\|workspaces/\${activeWorkspaceId}/members" packages/web/src`
Expected: no matches (all references removed).

---

## Task 8: Final verification — typecheck + unit tests

- [ ] **Step 1: Typecheck the whole repo**

Run: `npm run typecheck`
Expected: PASS (no type errors). If `packages/web` and `packages/identity` are not both covered by the root script, also run `npm run typecheck -w @journeyman/web` and `npm run typecheck -w @journeyman/identity`.

- [ ] **Step 2: Run the identity unit tests**

Run: `npm test -w @journeyman/identity`
Expected: PASS, including the new `updateWorkspace` tests from Task 1.

- [ ] **Step 3: Leave changes uncommitted**

Per the requester's instruction, do **not** commit. Run `git status` and confirm the expected set of modified/created/deleted files is present in the working tree.

---

## Self-review notes (against the spec)

- **Detail page + tabs (Overview/Members/Settings)** → Tasks 5–6. ✓
- **Members tab = re-homed member UI, no `WorkspaceContext`** → Task 4 (`WorkspaceMembersPanel` takes `orgId`/`wsId` props). ✓
- **Settings: rename + slug + Danger Zone delete** → Task 5 Step 4. ✓
- **New backend `GET` + `PATCH`, org-admin guarded, slug 409, no migration** → Tasks 1–2. ✓
- **Standalone `/workspaces/:wsId/members` route removed; sidebar link removed** → Task 6 Steps 2 & 4–5. ✓
- **Access = org admin + super admin only** → detail route gated by `isAdmin` in `App.tsx` (same `role === "admin"` flag used for the workspaces list; platform admins are surfaced as `admin` by `useAuth`). ✓
- **Overview has no resource counts (deferred)** → Overview shows name/slug/created/member-count only. ✓
- **Type consistency**: `WorkspaceDetail` (Task 3) is the return type of `getOne`/`update` and the `workspace` field of `WorkspaceDetailContext` (Task 5), consumed by all three tabs. `updateWorkspace` signature matches between Task 1 (definition) and Task 2 (call). ✓
