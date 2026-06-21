# Workspace Members Tab — Design

**Date:** 2026-06-21
**Status:** Approved (pending spec review)

## Context

On 2026-06-20, [`2026-06-20-remove-workspace-members-design.md`](2026-06-20-remove-workspace-members-design.md)
removed per-workspace membership management. After that change:

- Workspace access is **automatic**: every org member gets `contributor` on all
  workspaces in their org; org admins get `maintainer`. This is derived in
  `loadWorkspaceAccess` ([`packages/identity/src/authz.ts`](../../../packages/identity/src/authz.ts)),
  not from `jm_workspace_members` rows.
- The Members tab, `WorkspaceMembersPanel`, `AddMemberDialog`, the member API routes, and the
  `web` API client methods were all deleted.
- The `jm_workspace_members` table (migration 047) and **all** DB helpers in
  [`packages/identity/src/db-workspaces.ts`](../../../packages/identity/src/db-workspaces.ts)
  (`upsertWorkspaceMember`, `getWorkspaceMember`, `listWorkspaceMembersWithUsers`,
  `removeWorkspaceMember`, `updateWorkspaceMemberRole`) were left intact but inert.

## Goal

Re-introduce a **Members tab** on the workspace detail page (org-admin only) that lets an admin:

- See the users associated with a workspace, **paginated**.
- **Associate** a user (pick from org members not yet associated) with a workspace role.
- **Update** a member's workspace role inline.
- **Remove** a member.

## Access model (decided)

**Access semantics are unchanged.** This feature is **UI + API only** — it manages
`jm_workspace_members` rows for *role assignment*, not access gating.

- `loadWorkspaceAccess` is **not** modified. Org members keep automatic `contributor`
  access; org admins keep `maintainer`. No one is locked out.
- An explicit `jm_workspace_members` row records an assigned role. Because
  `loadWorkspaceAccess` already prefers an explicit `ws_role` row over the fallback, adding a
  row with role `maintainer` elevates that user; a row with `contributor`/`observer` records the
  role explicitly. (Note: with the current fallback, `observer` is *not* a downgrade below the
  automatic `contributor` floor — see Non-goals.)
- **No migration. No authz change. No backfill.** Zero lockout risk.

## Non-goals

- Changing `loadWorkspaceAccess` or any permission-gating logic.
- Making membership the access gate (the rejected high-risk option requiring a backfill).
- Enforcing `observer` as a true downgrade below the automatic contributor floor. Today the
  fallback floor is `contributor`; an `observer` row does not reduce access below that. Tightening
  the floor is out of scope and would reintroduce lockout risk.
- Adding net-new users to the org (that is the existing org invite flow on the org members page).
- Bulk add (one user at a time, consistent with the prior `AddMemberDialog` decision).

## Backend

### Routes — [`packages/identity/src/routes/workspaces.ts`](../../../packages/identity/src/routes/workspaces.ts)

Re-add member routes, nested under the existing org-scoped workspace routes, all behind the
existing `role: "admin"` middleware (org admin only). All operate on a workspace already validated
to belong to `:orgId`.

| Method | Path | Body / Query | Purpose |
|---|---|---|---|
| `GET` | `/api/orgs/:orgId/workspaces/:wsId/members` | `?page=1&limit=20` | Paginated member list → `{ items, total, page, limit }` |
| `GET` | `/api/orgs/:orgId/workspaces/:wsId/addable-members` | `?q=` | Org members **not** already in the workspace, for the picker |
| `POST` | `/api/orgs/:orgId/workspaces/:wsId/members` | `{ userId, role }` | Associate a user |
| `PATCH` | `/api/orgs/:orgId/workspaces/:wsId/members/:userId` | `{ role }` | Update workspace role |
| `DELETE` | `/api/orgs/:orgId/workspaces/:wsId/members/:userId` | — | Remove member |

Validation:
- `role` must be one of `maintainer` / `contributor` / `observer` (`WorkspaceRole`).
- On `POST`, `userId` must be a member of `:orgId` (reject otherwise with 400/404) — prevents
  associating users from outside the org.
- `page` ≥ 1, `limit` clamped to a sane max (e.g. 1–100, default 20).

Re-add the imports these routes need from `db-workspaces.ts`
(`upsertWorkspaceMember`, `getWorkspaceMember`, `removeWorkspaceMember`,
`updateWorkspaceMemberRole`, plus the new paginated/addable helpers below).

### Audit logging (write operations)

Audit the three **write** operations the same way as other mutating routes — declaratively via the
central `onResponse` hook driven by per-route `config.audit` tags (see
[`2026-06-21-audit-logging-coverage`](../plans/2026-06-21-audit-logging-coverage.md)). The two `GET`
routes are not audited. No inline `audit()` calls; the hook persists a `jm_audit_log` row on each
2xx response.

| Route | `config.audit` | Handler sets |
|---|---|---|
| `POST .../members` | `{ action: "workspace.member.add", targetType: "workspace_member", idParam: "wsId" }` | `req.auditDetail = { userId, role }` |
| `PATCH .../members/:userId` | `{ action: "workspace.member.update_role", targetType: "workspace_member", idParam: "userId" }` | `req.auditDetail = { role }` |
| `DELETE .../members/:userId` | `{ action: "workspace.member.remove", targetType: "workspace_member", idParam: "userId" }` | — |

Action strings follow the existing `<resource>.<sub_resource>.<action>` convention (cf.
`agent.token.issue`). `orgId` is resolved by the hook from the validated workspace; the actor is the
authenticated admin. `detail` carries only `userId` / `role` — no sensitive data.

### DB helpers — [`packages/identity/src/db-workspaces.ts`](../../../packages/identity/src/db-workspaces.ts)

Reuse `upsertWorkspaceMember`, `updateWorkspaceMemberRole`, `removeWorkspaceMember`,
`getWorkspaceMember` as-is. Add two helpers:

1. **`listWorkspaceMembersPage(db, workspaceId, { limit, offset })`** → `{ items, total }`.
   Sibling to the existing `listWorkspaceMembersWithUsers` (left untouched to avoid touching its
   other callers). Returns the same row shape (`userId`, `username`, `displayName`, `role`,
   `createdAt`) ordered by `username ASC`, plus a total count. Implement with a `COUNT(*) OVER()`
   window column or a second count query.

2. **`listAddableOrgMembers(db, orgId, workspaceId, q?)`** → `Array<{ userId, username, displayName }>`.
   Org members (`jm_memberships`/org-membership table JOIN `jm_users`) **minus** users with a row
   in `jm_workspace_members` for `workspaceId`, with optional `username ILIKE '%q%'` (and
   `display_name ILIKE`) filter. Order by `username ASC`, cap results (e.g. LIMIT 50) since it
   feeds a search dropdown.

   *Confirm the exact org-membership table/column names against the existing org users query
   during implementation (the prior code used `listOrgUsers`).*

## Web API client — [`packages/web/src/api/workspaces.ts`](../../../packages/web/src/api/workspaces.ts)

Add to `workspaceAdminApi`:

- `listMembers(orgId, wsId, { page, limit }) → { items: WorkspaceMember[]; total; page; limit }`
- `listAddableMembers(orgId, wsId, q) → AddableMember[]`
- `addMember(orgId, wsId, { userId, role }) → void`
- `setMemberRole(orgId, wsId, userId, role) → void`
- `removeMember(orgId, wsId, userId) → void`

Types:
```ts
type WorkspaceRole = "maintainer" | "contributor" | "observer";
interface WorkspaceMember { userId: string; username: string; displayName: string | null; role: WorkspaceRole; createdAt: string; }
interface AddableMember { userId: string; username: string; displayName: string | null; }
```

## UI — `MembersTab.tsx`

New file `packages/web/src/routes/workspace-detail/MembersTab.tsx`, registered alongside
Overview / Settings. Uses `useOutletContext<WorkspaceDetailContext>()` for `orgId` / `wsId`.

Layout (per approved mockup):

- **Associate a user** card (top): a debounced search box → `listAddableMembers`, a results
  dropdown (avatar + username + display name), a role `<select>` (default `contributor`), and an
  **Add** button → `addMember`, then refresh the list and reset the search.
- **Members table**: avatar + username/display name, an inline **role dropdown** (change →
  `setMemberRole`, saved instantly), the added date, and a **remove** (trash) action per row.
- **Pagination**: "Showing X–Y of N" with Prev/Next, `limit` default 20, driven by `total` from
  the API.

Interactions (decided):
- Role change **saves instantly** on dropdown change (matches the org users page).
- Remove asks for a small **confirm** before deleting.
- On error: inline error message; busy state disables the relevant control.

Styling reuses `admin-styles.ts` (`inputCls`, `selectCls`, `btnPrimary`, `btnDanger`, `card`).

### Tab registration

- `packages/web/src/routes/WorkspaceDetailPage.tsx`: add `{ to: "members", label: "Members" }`
  to the `TABS` array.
- `packages/web/src/App.tsx`: add `<Route path="members" element={<MembersTab />} />` under
  `/orgs/:orgId/workspaces/:wsId`, and import `MembersTab`.
- (Optional) `packages/web/src/components/nav-config.ts`: re-add a workspace "Members" nav item if
  the sidebar should link to it. Only do this if the route is reachable; otherwise skip to avoid the
  dead-link problem called out in the removal spec.

## Data flow

```
Members tab mounts
  → listMembers(orgId, wsId, {page:1, limit:20}) → table + pagination render
User types in associate search (debounced)
  → listAddableMembers(orgId, wsId, q) → dropdown of org members not yet associated
Pick user + role + Add
  → addMember(orgId, wsId, {userId, role}) → refresh listMembers
Change a row's role
  → setMemberRole(orgId, wsId, userId, role) → optimistic/refresh
Remove (after confirm)
  → removeMember(orgId, wsId, userId) → refresh listMembers
```

## Error handling

- Non-org `userId` on add → 400/404, surfaced inline in the associate card.
- Invalid `role` → 400.
- List/add/role/remove failures → inline error; the relevant control re-enables.

## Testing

- Backend: unit-test `listAddableOrgMembers` (excludes existing members; filters by `q`) and
  `listWorkspaceMembersPage` (correct `total`, `limit`/`offset` slicing). Route tests for add
  validation (non-org user rejected, bad role rejected) and pagination params.
- Frontend: presentational; verify by `npm run typecheck` and manual check in the running app. If a
  pure helper is extracted (e.g. addable-list filtering), add a small Vitest unit test.
- `npm run check` (typecheck + import boundaries) passes.

## Files touched

**Backend**
- Modify: `packages/identity/src/routes/workspaces.ts` — re-add 5 member routes + imports.
- Modify: `packages/identity/src/db-workspaces.ts` — add `listWorkspaceMembersPage`,
  `listAddableOrgMembers`.

**Frontend**
- Create: `packages/web/src/routes/workspace-detail/MembersTab.tsx`.
- Modify: `packages/web/src/api/workspaces.ts` — re-add member methods + types.
- Modify: `packages/web/src/routes/WorkspaceDetailPage.tsx` — add Members tab.
- Modify: `packages/web/src/App.tsx` — add Members route.
- Optional: `packages/web/src/components/nav-config.ts` — re-add Members nav item.
