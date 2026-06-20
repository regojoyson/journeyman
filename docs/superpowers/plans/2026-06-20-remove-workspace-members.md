# Remove Workspace Member Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove workspace-level member management (UI + API routes) and flatten access control so all org members automatically have contributor access to every workspace in their org.

**Architecture:** Two-package change — `packages/identity` drops the 4 `GET/POST/PATCH/DELETE /api/workspaces/:wsId/members` routes, flattens `loadWorkspaceAccess` to synthesise a `contributor` member for any org member without an explicit workspace row, and makes `GET /api/workspaces` return all org workspaces for everyone. `packages/web` deletes five files (members panel, add-member dialog, add-member utils + its test, and the MembersTab route component) and trims the nav config, sidebar, workspace detail page, router, and API client.

**Tech Stack:** React, TypeScript, Fastify, PostgreSQL, react-router-dom, Vitest.

**Workflow constraints:** Stay on **master** branch. **No commits.** Single `npx tsc --noEmit` run at the very end as the only verification gate.

**Spec:** `docs/superpowers/specs/2026-06-20-remove-workspace-members-design.md`

---

## File map

| Action | File |
|---|---|
| Edit | `packages/identity/src/authz.ts` |
| Edit | `packages/identity/src/routes/workspaces.ts` |
| Delete | `packages/web/src/routes/workspace-detail/MembersTab.tsx` |
| Delete | `packages/web/src/components/WorkspaceMembersPanel.tsx` |
| Delete | `packages/web/src/components/AddMemberDialog.tsx` |
| Delete | `packages/web/src/components/add-member-utils.ts` |
| Delete | `packages/web/src/components/add-member-utils.test.ts` |
| Edit | `packages/web/src/components/nav-config.ts` |
| Edit | `packages/web/src/components/nav-config.test.ts` |
| Edit | `packages/web/src/components/Sidebar.tsx` |
| Edit | `packages/web/src/routes/WorkspaceDetailPage.tsx` |
| Edit | `packages/web/src/App.tsx` |
| Edit | `packages/web/src/api/workspaces.ts` |

---

## Task 1: Flatten `loadWorkspaceAccess` in `authz.ts`

**Files:**
- Modify: `packages/identity/src/authz.ts:39-41`

This is the single query that feeds every workspace permission check. When a user has no `jm_workspace_members` row but does have an `org_role` (i.e., they are an org member), synthesise a `contributor` member so `evaluateCan` grants them workspace access.

- [ ] **Step 1: Replace the `member` derivation (lines 39–41)**

Find:
```typescript
  const member: WorkspaceMemberLike | null = row.ws_role
    ? { role: row.ws_role as WorkspaceRole, permissions: row.ws_permissions ?? null }
    : null;
```

Replace with:
```typescript
  const member: WorkspaceMemberLike | null = row.ws_role
    ? { role: row.ws_role as WorkspaceRole, permissions: row.ws_permissions ?? null }
    : row.org_role
      ? { role: "contributor" as WorkspaceRole, permissions: null }
      : null;
```

No import changes needed — `WorkspaceRole` and `WorkspaceMemberLike` are already imported.

---

## Task 2: Rewrite `workspaces.ts` — remove member routes, flatten `GET /api/workspaces`

**Files:**
- Modify: `packages/identity/src/routes/workspaces.ts`

Replace the entire file. Changes vs. current:
- `GET /api/workspaces`: remove the non-admin `listWorkspacesForUser` branch; both paths now call `listWorkspacesForOrg`. Regular members get `contributor` role and permissions.
- `POST /api/orgs/:orgId/workspaces`: remove the `upsertWorkspaceMember` auto-add-creator call (and its `reply.code(201)` is moved up to be on the `ws` line directly).
- Remove the 4 member CRUD routes entirely.
- Drop unused imports: `listWorkspacesForUser`, `listWorkspaceMembersWithUsers`, `getWorkspaceMember`, `upsertWorkspaceMember`, `removeWorkspaceMember`, `updateWorkspaceMemberRole`, `makeRequireWorkspacePermission`, `resolvePermissions`.
- Drop unused constants/helpers: `WORKSPACE_ROLES`, `isRole`, `const requirePerm`.

- [ ] **Step 1: Replace the entire file**

```typescript
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { roleGrants } from "@journeyman/core";
import { makeRequireAuth } from "../middleware.ts";
import {
  listWorkspacesForOrg,
  slugifyWorkspaceName,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  updateWorkspace,
} from "../db-workspaces.ts";

export async function registerWorkspaceRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  // All org members see all org workspaces. Admins get maintainer; everyone else gets contributor.
  app.get("/api/workspaces", { preHandler: requireAuth() }, async (req) => {
    const ctx = req.runContext!;
    const orgId = ctx.org.id;
    const isAdmin = ctx.isPlatformAdmin || ctx.role === "admin";
    const all = await listWorkspacesForOrg(pool, orgId);

    if (isAdmin) {
      const perms = [...roleGrants("maintainer")];
      return {
        workspaces: all.map((w) => ({
          id: w.id, orgId: w.orgId, name: w.name, slug: w.slug,
          role: "maintainer" as const, permissions: perms,
        })),
      };
    }

    const perms = [...roleGrants("contributor")];
    return {
      workspaces: all.map((w) => ({
        id: w.id, orgId: w.orgId, name: w.name, slug: w.slug,
        role: "contributor" as const, permissions: perms,
      })),
    };
  });

  // --- Org-admin: list / create / get / update / delete workspaces ---
  app.get("/api/orgs/:orgId/workspaces", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });
    return { workspaces: await listWorkspacesForOrg(pool, orgId) };
  });

  app.post("/api/orgs/:orgId/workspaces", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });
    const body = req.body as { name?: string; slug?: string };
    if (!body?.name?.trim()) return reply.code(400).send({ error: "missing_name" });
    const slug = body.slug?.trim() || slugifyWorkspaceName(body.name);
    try {
      const ws = await createWorkspace(pool, { orgId, slug, name: body.name.trim() });
      reply.code(201);
      return ws;
    } catch (err: any) {
      if (err?.code === "23505") return reply.code(409).send({ error: "slug_exists" });
      throw err;
    }
  });

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

  app.delete("/api/orgs/:orgId/workspaces/:wsId", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId, wsId } = req.params as { orgId: string; wsId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });
    const ws = await getWorkspace(pool, wsId);
    if (!ws || ws.orgId !== orgId) return reply.code(404).send({ error: "not_found" });
    if (ws.slug === "default") return reply.code(409).send({ error: "cannot_delete_default" });
    await deleteWorkspace(pool, wsId, orgId);
    return { ok: true };
  });
}
```

---

## Task 3: Delete five frontend files

**Files:**
- Delete: `packages/web/src/routes/workspace-detail/MembersTab.tsx`
- Delete: `packages/web/src/components/WorkspaceMembersPanel.tsx`
- Delete: `packages/web/src/components/AddMemberDialog.tsx`
- Delete: `packages/web/src/components/add-member-utils.ts`
- Delete: `packages/web/src/components/add-member-utils.test.ts`

- [ ] **Step 1: Delete all five files**

```bash
rm packages/web/src/routes/workspace-detail/MembersTab.tsx \
   packages/web/src/components/WorkspaceMembersPanel.tsx \
   packages/web/src/components/AddMemberDialog.tsx \
   packages/web/src/components/add-member-utils.ts \
   packages/web/src/components/add-member-utils.test.ts
```

---

## Task 4: Update `nav-config.ts` and `nav-config.test.ts`

**Files:**
- Modify: `packages/web/src/components/nav-config.ts`
- Modify: `packages/web/src/components/nav-config.test.ts`

Remove the `members` nav item from the workspace group and the `perm` field from `NavItem` (no remaining item uses it). Update the test that asserted the members item existed.

- [ ] **Step 1: Remove `perm` from `NavItem` type and the members item from the workspace group**

In `nav-config.ts`, replace:

```typescript
export type NavItem = {
  slug: string;
  icon: string;
  label: string;
  /** Workspace-scoped permission required to show this item. */
  perm?: "members.manage";
};
```

With:

```typescript
export type NavItem = {
  slug: string;
  icon: string;
  label: string;
};
```

- [ ] **Step 2: Remove the members item from the workspace group**

In `nav-config.ts`, replace:

```typescript
  {
    id: "workspace",
    label: "Workspace",
    scope: "workspace",
    items: [
      { slug: "workflows", icon: "⚡", label: "Workflows" },
      { slug: "workflow-instances", icon: "▶", label: "Workflow Instances" },
      { slug: "agents", icon: "🤖", label: "Agents" },
      { slug: "custom-steps", icon: "🧩", label: "Custom Steps" },
      { slug: "members", icon: "👤", label: "Members", perm: "members.manage" },
    ],
  },
```

With:

```typescript
  {
    id: "workspace",
    label: "Workspace",
    scope: "workspace",
    items: [
      { slug: "workflows", icon: "⚡", label: "Workflows" },
      { slug: "workflow-instances", icon: "▶", label: "Workflow Instances" },
      { slug: "agents", icon: "🤖", label: "Agents" },
      { slug: "custom-steps", icon: "🧩", label: "Custom Steps" },
    ],
  },
```

- [ ] **Step 3: Update the nav-config test — replace the members-gate assertion**

In `packages/web/src/components/nav-config.test.ts`, replace:

```typescript
  it("gates the workspace Members item behind members.manage", () => {
    const ws = NAV_GROUPS.find((g) => g.id === "workspace")!;
    expect(ws.items.find((i) => i.slug === "members")?.perm).toBe("members.manage");
  });
```

With:

```typescript
  it("has no members item in the workspace group", () => {
    const ws = NAV_GROUPS.find((g) => g.id === "workspace")!;
    expect(ws.items.find((i) => i.slug === "members")).toBeUndefined();
  });
```

---

## Task 5: Update `Sidebar.tsx` — remove perm filter

**Files:**
- Modify: `packages/web/src/components/Sidebar.tsx`

The sidebar's `gated` computation filtered items by `i.perm`. With `perm` removed from `NavItem`, drop `can` from the destructure and simplify the filter.

- [ ] **Step 1: Remove `can` from the `useWorkspace` destructure**

Find:

```typescript
  const { activeWorkspaceId, can } = useWorkspace();
```

Replace with:

```typescript
  const { activeWorkspaceId } = useWorkspace();
```

- [ ] **Step 2: Simplify the `gated` computation — remove the perm filter**

Find:

```typescript
  const gated: NavGroup[] = NAV_GROUPS.flatMap((group) => {
    if (group.adminOnly && !isAdmin) return [];
    if (group.scope === "workspace" && !activeWorkspaceId) return [];
    if (group.scope === "org" && !activeOrgId) return [];
    const items = group.items.filter((i) => !i.perm || can(i.perm));
    return items.length ? [{ ...group, items }] : [];
  });
```

Replace with:

```typescript
  const gated: NavGroup[] = NAV_GROUPS.flatMap((group) => {
    if (group.adminOnly && !isAdmin) return [];
    if (group.scope === "workspace" && !activeWorkspaceId) return [];
    if (group.scope === "org" && !activeOrgId) return [];
    return [group];
  });
```

---

## Task 6: Update `WorkspaceDetailPage.tsx` — remove Members tab

**Files:**
- Modify: `packages/web/src/routes/WorkspaceDetailPage.tsx:13-17`

- [ ] **Step 1: Remove the members entry from TABS**

Find:

```typescript
const TABS = [
  { to: "overview", label: "Overview" },
  { to: "members", label: "Members" },
  { to: "settings", label: "Settings" },
];
```

Replace with:

```typescript
const TABS = [
  { to: "overview", label: "Overview" },
  { to: "settings", label: "Settings" },
];
```

---

## Task 7: Update `App.tsx` — remove MembersTab import and route

**Files:**
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Remove the MembersTab import**

Find:

```typescript
import { MembersTab } from "./routes/workspace-detail/MembersTab.tsx";
```

Delete that line entirely.

- [ ] **Step 2: Remove the members nested route**

Find:

```typescript
          <Route path="overview" element={<OverviewTab />} />
          <Route path="members" element={<MembersTab />} />
          <Route path="settings" element={<SettingsTab />} />
```

Replace with:

```typescript
          <Route path="overview" element={<OverviewTab />} />
          <Route path="settings" element={<SettingsTab />} />
```

---

## Task 8: Update `api/workspaces.ts` — remove member API methods

**Files:**
- Modify: `packages/web/src/api/workspaces.ts`

Remove `listMembers`, `addMember`, `setMemberRole`, `removeMember` from `workspaceAdminApi` and remove `listOrgUsers`, `OrgUser`, and `WorkspaceMember` exports (only consumed by the deleted files).

- [ ] **Step 1: Replace the entire file**

```typescript
import { api } from "./client.ts";
import type { WorkspacePermission, WorkspaceRole } from "@journeyman/core";

export interface WorkspaceSummary {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  permissions: WorkspacePermission[];
}

export function listMyWorkspaces(): Promise<{ workspaces: WorkspaceSummary[] }> {
  return api<{ workspaces: WorkspaceSummary[] }>("/api/workspaces");
}

export interface OrgWorkspace { id: string; orgId: string; name: string; slug: string; }
export interface WorkspaceDetail { id: string; orgId: string; name: string; slug: string; createdAt: string; }

export const workspaceAdminApi = {
  listForOrg: (orgId: string) =>
    api<{ workspaces: OrgWorkspace[] }>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces`).then((r) => r.workspaces),
  create: (orgId: string, body: { name: string; slug?: string }) =>
    api<OrgWorkspace>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces`, { method: "POST", body: JSON.stringify(body) }),
  remove: (orgId: string, wsId: string) =>
    api<{ ok: true }>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}`, { method: "DELETE" }),
  getOne: (orgId: string, wsId: string) =>
    api<WorkspaceDetail>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}`),
  update: (orgId: string, wsId: string, body: { name: string; slug?: string }) =>
    api<WorkspaceDetail>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};
```

---

## Task 9: Final typecheck

- [ ] **Step 1: Typecheck the identity package**

Run: `npx tsc --noEmit -p packages/identity`
Expected: exit 0, no output.

- [ ] **Step 2: Typecheck the web package**

Run: `npx tsc --noEmit -p packages/web`
Expected: exit 0, no output.

If errors appear, fix them in the relevant task's file and re-run until both pass. **No commit** — leave changes in the working tree for review.

---

## Self-Review

**Spec coverage:**
- Remove 4 member CRUD routes → Task 2 ✓
- Remove auto-add creator as maintainer on workspace creation → Task 2 ✓
- `GET /api/workspaces` returns all org workspaces for all members → Task 2 ✓
- `loadWorkspaceAccess` synthesises contributor for org members without a ws row → Task 1 ✓
- Delete 5 frontend files → Task 3 ✓
- Remove workspace Members nav item and `perm` from NavItem → Task 4 ✓
- Update failing nav-config test → Task 4 ✓
- Remove `can` perm filter from Sidebar → Task 5 ✓
- Remove Members tab from WorkspaceDetailPage → Task 6 ✓
- Remove MembersTab import and route from App.tsx → Task 7 ✓
- Remove member API methods and types from api/workspaces.ts → Task 8 ✓

**Placeholder scan:** None — every step shows complete code or an exact shell command.

**Type consistency:**
- `WorkspaceRole` used as a cast in Task 1 (`authz.ts`) and already imported there. ✓
- `roleGrants` used in Task 2 (`workspaces.ts`) and imported at the top of the replacement file. ✓
- `NavItem` loses `perm` in Task 4; `Sidebar.tsx` Task 5 drops `can` and the perm filter — no remaining reference to `i.perm` or `can`. ✓
- `MembersTab` removed from import and JSX in Task 7; the file is deleted in Task 3. ✓
- `WorkspaceMember`, `OrgUser`, `listOrgUsers` removed in Task 8; all consumers are in deleted files (Task 3). ✓
