# Workspace Scoping — Phase 4: Workspace + Member Admin UI — Implementation Plan

> Builds the slice deferred from Phase 3: org-admin workspace CRUD and per-workspace member management. Two sub-phases — 4a backend routes, 4b UI. Each its own commit; typecheck clean between them.

**Branch:** `feat/workspace-scoping-phase-2b`. **No migration** — `jm_workspaces` / `jm_workspace_members` already exist (migration 047), and `db-workspaces.ts` already has every write helper (`createWorkspace`, `deleteWorkspace`, `upsertWorkspaceMember`, `removeWorkspaceMember`, `updateWorkspaceMemberRole`, `listWorkspaceMembers`).

**What this completes:** spec §9 — "Org admin screens: create/delete workspaces; assign org users to workspaces and set their workspace role" + "Workspace member management for maintainers (`/api/workspaces/:wsId/members`)".

## Design decisions (baked in)

1. **Workspace create** (`POST /api/orgs/:orgId/workspaces`): body `{ name, slug? }`. If `slug` omitted, derive kebab-case from `name` (`lowercase`, non-alnum → `-`, collapse/trim dashes; fallback `"workspace"` if empty). On DB unique violation (23505 on `(org_id, slug)`) → 409 `slug_exists`. Creator (the org admin) is auto-added as a `maintainer` member so the new workspace shows in their switcher immediately.
2. **Delete workspace** (`DELETE /api/orgs/:orgId/workspaces/:wsId`): **block deleting the `default` workspace** (builder-apply.ts resolves `slug='default'` as its creation target) → 409 `cannot_delete_default`. Otherwise cascade-deletes all resources (FK `ON DELETE CASCADE`). UI requires typing the workspace name to confirm.
3. **Member roles:** `maintainer | contributor | observer` (the `WorkspaceRole` union).
4. **Add member:** pick an org user (from `GET /api/orgs/:orgId/memberships`) not already a workspace member, assign a role.
5. **No last-maintainer guard:** org admins hold implicit maintainer access on every workspace (`evaluateCan`), so removing the last explicit maintainer never locks anyone out. Allow any member removal/role change.
6. **Authz:** workspace CRUD = org admin (`requireAuth({ role: "admin" })` + org-match, matching `orgs.ts`). Member management = `makeRequireWorkspacePermission("members.manage")` (maintainer / org admin / platform admin).

---

## Phase 4a — Backend routes

### 1. DB helper `packages/identity/src/db-workspaces.ts`

Add a members-with-user-info join (the list route needs usernames/display names):

```ts
export async function listWorkspaceMembersWithUsers(
  db: Queryable, workspaceId: string,
): Promise<Array<{ userId: string; username: string; displayName: string | null; role: WorkspaceRole; createdAt: Date }>> {
  const r = await db.query(
    `SELECT wm.user_id, wm.role, wm.created_at, u.username, u.display_name
       FROM jm_workspace_members wm
       JOIN jm_users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1
      ORDER BY u.username ASC`,
    [workspaceId],
  );
  return r.rows.map((row) => ({
    userId: row.user_id, username: row.username, displayName: row.display_name ?? null,
    role: row.role as WorkspaceRole, createdAt: new Date(row.created_at),
  }));
}
```

Add a slug helper (or inline in the route):
```ts
export function slugifyWorkspaceName(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
  return s || "workspace";
}
```

### 2. Extend `packages/identity/src/routes/workspaces.ts`

Add to the existing `registerWorkspaceRoutes(app, pool)` (keep the existing `GET /api/workspaces`). Import `makeRequireWorkspacePermission` from `../authz.ts`, the new helpers, and the existing `createWorkspace`, `deleteWorkspace`, `getWorkspace`, `listWorkspacesForOrg`, `upsertWorkspaceMember`, `removeWorkspaceMember`, `updateWorkspaceMemberRole`, `getWorkspaceMember` from `../db-workspaces.ts`.

```ts
const requirePerm = makeRequireWorkspacePermission({ pool });
const WORKSPACE_ROLES = ["maintainer", "contributor", "observer"] as const;
function isRole(v: unknown): v is (typeof WORKSPACE_ROLES)[number] {
  return typeof v === "string" && (WORKSPACE_ROLES as readonly string[]).includes(v);
}

// --- Org-admin: list/create/delete workspaces ---
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
    // creator becomes a maintainer member so it appears in their switcher
    await upsertWorkspaceMember(pool, { workspaceId: ws.id, userId: req.runContext!.user.id, role: "maintainer" });
    reply.code(201);
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

// --- Member management (members.manage = maintainer / org admin / platform admin) ---
app.get("/api/workspaces/:wsId/members", { preHandler: [requireAuth(), requirePerm("members.manage")] }, async (req) => {
  const { wsId } = req.params as { wsId: string };
  return { members: await listWorkspaceMembersWithUsers(pool, wsId) };
});

app.post("/api/workspaces/:wsId/members", { preHandler: [requireAuth(), requirePerm("members.manage")] }, async (req, reply) => {
  const { wsId } = req.params as { wsId: string };
  const body = req.body as { userId?: string; role?: string };
  if (!body?.userId || !isRole(body.role)) return reply.code(400).send({ error: "bad_request" });
  const member = await upsertWorkspaceMember(pool, { workspaceId: wsId, userId: body.userId, role: body.role });
  reply.code(201);
  return member;
});

app.patch("/api/workspaces/:wsId/members/:userId", { preHandler: [requireAuth(), requirePerm("members.manage")] }, async (req, reply) => {
  const { wsId, userId } = req.params as { wsId: string; userId: string };
  const body = req.body as { role?: string };
  if (!isRole(body.role)) return reply.code(400).send({ error: "bad_role" });
  const existing = await getWorkspaceMember(pool, wsId, userId);
  if (!existing) return reply.code(404).send({ error: "not_found" });
  await updateWorkspaceMemberRole(pool, wsId, userId, body.role);
  return { ok: true };
});

app.delete("/api/workspaces/:wsId/members/:userId", { preHandler: [requireAuth(), requirePerm("members.manage")] }, async (req) => {
  const { wsId, userId } = req.params as { wsId: string; userId: string };
  await removeWorkspaceMember(pool, wsId, userId);
  return { ok: true };
});
```

Notes:
- `requireAuth` is already constructed at the top of the function (`const requireAuth = makeRequireAuth({ pool })`).
- The member routes pass `[requireAuth(), requirePerm("members.manage")]` — `requireAuth()` populates `req.runContext`, then `requirePerm` reads `:wsId`, 404s if the workspace is missing, 403s without permission.
- `createWorkspace`'s RETURNING already includes `updated_at` (verified) so `WorkspaceRecord` maps cleanly.

### 3. Verify + commit (4a)
```
npm run typecheck
npm run check:boundaries
git add -A
git commit -m "feat(workspaces): org-admin workspace CRUD + workspace member-management routes (phase 4a)"
git cat-file -e HEAD:packages/identity/src/routes/workspaces.ts && echo "4a in HEAD ✓"
```
Optional smoke (dev stack up): `POST /api/orgs/:orgId/workspaces {name:"QA"}` → 201; appears in `GET /api/workspaces`; `POST /api/workspaces/:wsId/members {userId,role}` → 201.

---

## Phase 4b — UI

### 1. API client `packages/web/src/api/workspaces.ts` (extend)

Add alongside the existing `listMyWorkspaces`:
```ts
import type { WorkspaceRole } from "@journeyman/core";

export interface OrgWorkspace { id: string; orgId: string; name: string; slug: string; }
export interface WorkspaceMember { userId: string; username: string; displayName: string | null; role: WorkspaceRole; createdAt: string; }

export const workspaceAdminApi = {
  listForOrg: (orgId: string) =>
    api<{ workspaces: OrgWorkspace[] }>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces`).then((r) => r.workspaces),
  create: (orgId: string, body: { name: string; slug?: string }) =>
    api<OrgWorkspace>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces`, { method: "POST", body: JSON.stringify(body) }),
  remove: (orgId: string, wsId: string) =>
    api<{ ok: true }>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}`, { method: "DELETE" }),
  listMembers: (wsId: string) =>
    api<{ members: WorkspaceMember[] }>(`/api/workspaces/${encodeURIComponent(wsId)}/members`).then((r) => r.members),
  addMember: (wsId: string, body: { userId: string; role: WorkspaceRole }) =>
    api(`/api/workspaces/${encodeURIComponent(wsId)}/members`, { method: "POST", body: JSON.stringify(body) }),
  setMemberRole: (wsId: string, userId: string, role: WorkspaceRole) =>
    api(`/api/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  removeMember: (wsId: string, userId: string) =>
    api(`/api/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
};
```
The member picker needs the org's users: reuse the existing org memberships endpoint. Check `packages/web/src/api/` for an existing client hitting `/api/orgs/:orgId/memberships` (AdminUsersPage uses one — reuse it; otherwise add `listOrgMemberships(orgId)` returning `{ user: { id, username, displayName }, role }[]`).

### 2. New page `packages/web/src/routes/WorkspaceMembersPage.tsx`

Route `/workspaces/:wsId/members`. Reads `useParams().wsId`. Gated by `useWorkspace().can("members.manage")` — if false, render a "You don't have access" notice (the backend also 403s). Shows:
- A table of members (username/displayName · role · remove button · role `<select>` to change).
- An "Add member" control: a `<select>` of org users NOT already members (diff `listOrgMemberships(orgId)` against current members by userId) + a role `<select>` + Add button. Get `orgId` from `useWorkspace().activeWorkspace?.orgId` (the active workspace matches the route `wsId`).
- Match existing admin page styling (`admin-styles.ts`: `card`, `btnPrimary`, `btnDanger`, `inputCls`, `selectCls`).

### 3. New page `packages/web/src/routes/OrgWorkspacesPage.tsx`

Route `/orgs/:orgId/workspaces`. Reads `useParams().orgId`. Admin-gated (route wrapper). Shows:
- Table of workspaces (name · slug · delete button; the `default` workspace's delete is disabled with a tooltip "the default workspace can't be deleted").
- "New workspace" form: name input (+ optional slug) → `workspaceAdminApi.create`. On success refresh; the new workspace also appears in the switcher after the next `/api/workspaces` fetch (note: the `WorkspaceProvider` fetches once on mount — a full refresh or re-login surfaces it; acceptable for this phase, or call `window.location` navigation. Do NOT add provider-refresh plumbing this phase).
- Delete: a confirm dialog requiring the user to type the workspace name before the delete button enables (cascades all resources — make the warning explicit: "This permanently deletes all flows, agents, secrets, connections, MCPs, skills, custom steps, and webhooks in this workspace.").

### 4. Routes `packages/web/src/App.tsx`

Add:
```
/workspaces/:wsId/members  → <WorkspaceMembersPage/>
/orgs/:orgId/workspaces    → isAdmin ? <OrgWorkspacesPage/> : <Navigate to="/" replace/>
```

### 5. Sidebar `packages/web/src/components/Sidebar.tsx`

- Add to `WORKSPACE_ITEMS`: `{ slug: "members", icon: "👤", label: "Members" }` — but it must only render for `members.manage` holders. Since `WORKSPACE_ITEMS` renders unconditionally, gate this one entry: render the `Members` workspace link only when `can("members.manage")`. Simplest: keep `members` OUT of the static `WORKSPACE_ITEMS` array and render it as a separate conditional `<NavLink>` right after the array `.map`, guarded by `useWorkspace().can("members.manage")`. Pull `can` from `useWorkspace()` in the Sidebar (already imported).
- Add to `ORG_ITEMS`: `{ slug: "workspaces", icon: "🗂", label: "Workspaces" }` (org admins only — `ORG_ITEMS` already renders under the `isAdmin` guard).

### 6. Verify + commit (4b)
```
npm run typecheck
npm run check:boundaries
git add -A
git commit -m "feat(web): workspace member management + org workspace admin pages; sidebar Members/Workspaces entries (phase 4b)"
git cat-file -e HEAD:packages/web/src/routes/WorkspaceMembersPage.tsx && echo "4b in HEAD ✓"
```

---

## Notes
- **No provider auto-refresh:** creating a workspace won't update the switcher until the next `/api/workspaces` fetch (page reload / re-login). Adding live refresh (exposing a `refresh()` from `WorkspaceProvider`) is a nice-to-have, explicitly out of scope here to keep the diff tight.
- **Default workspace is protected** from deletion (builder dependency). Everything else cascades.
- **Org admins need no explicit membership** to manage members (implicit maintainer via `evaluateCan`), but the create flow still adds the creator as an explicit maintainer so the new workspace is immediately visible in their (non-admin-path) switcher list — harmless for admins (who'd see it anyway) and correct for the general case.
- **Gremlin guard:** no migration, but `git cat-file -e HEAD:<file>` after each commit per [[concurrent-worktree-activity]].
