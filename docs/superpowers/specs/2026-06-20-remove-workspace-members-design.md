# Remove Workspace Member Management — Design

**Date:** 2026-06-20
**Status:** Approved

## Problem

Workspace membership is a separate concept from org membership, requiring org admins to manage two lists: who is in the org (`/orgs/:orgId/members`) and who is in each workspace (`WorkspaceMembersPanel`). The workspace-level member CRUD (add, remove, change role) is redundant given that org membership is the real gate. The workspace Members sidebar link points to a dead route (`/workspaces/:wsId/members` has no matching `<Route>`), and the Members tab in the org-admin workspace detail page replicates management that should live at the org level.

## Goal

Collapse workspace access control onto org membership: any authenticated org member automatically has `contributor`-level access to all workspaces in their org. Org admins retain `maintainer`-level access (unchanged). Remove all UI and API surfaces for managing explicit workspace membership rows.

## Non-goals

- Removing the `jm_workspace_members` table or DB helpers — no migration, no breaking DB layer changes.
- Changing any other permission levels (`settings.manage`, `resource.write`, etc.) — the `evaluateCan` logic is unchanged; only the `member` input it receives changes.
- Adding any new UI for workspace-level roles.

## Approach

**Flatten access via `loadWorkspaceAccess`** — the single query that feeds every workspace permission check. When no explicit `jm_workspace_members` row exists, treat any org member as `contributor`. Org admins already bypass `member` via `isOrgAdmin`. No changes to `evaluateCan` in `@journeyman/core`.

## Frontend Removals

### Files deleted
| File | Reason |
|---|---|
| `packages/web/src/routes/workspace-detail/MembersTab.tsx` | Tab component no longer needed |
| `packages/web/src/components/WorkspaceMembersPanel.tsx` | Member list/add/remove UI removed |
| `packages/web/src/components/AddMemberDialog.tsx` | Add-member dialog removed |
| `packages/web/src/components/add-member-utils.ts` | Filter utility only used by AddMemberDialog |
| `packages/web/src/components/add-member-utils.test.ts` | Tests for deleted utility |

### Files edited

**`packages/web/src/components/nav-config.ts`**
Remove `{ slug: "members", icon: "👤", label: "Members", perm: "members.manage" }` from the workspace group. The `perm` field type `"members.manage"` on `NavItem` can also be removed since no remaining item uses it.

**`packages/web/src/routes/WorkspaceDetailPage.tsx`**
Remove `{ to: "members", label: "Members" }` from the `TABS` array. The workspace detail page now has two tabs: Overview and Settings.

**`packages/web/src/App.tsx`**
Remove `MembersTab` import and the `<Route path="members" element={<MembersTab />} />` nested route under `/orgs/:orgId/workspaces/:wsId`.

**`packages/web/src/api/workspaces.ts`**
Remove from `workspaceAdminApi`: `listMembers`, `addMember`, `setMemberRole`, `removeMember`.
Remove top-level export: `listOrgUsers`.
Remove types: `OrgUser`, `WorkspaceMember`.

## Backend Changes

### `packages/identity/src/routes/workspaces.ts`

**Remove the 4 member CRUD routes:**
- `GET /api/workspaces/:wsId/members`
- `POST /api/workspaces/:wsId/members`
- `PATCH /api/workspaces/:wsId/members/:userId`
- `DELETE /api/workspaces/:wsId/members/:userId`

**Remove `requirePerm` and its factory:** `makeRequireWorkspacePermission` is only used for the member routes; drop the import and the `const requirePerm = makeRequireWorkspacePermission({ pool })` call.

**Remove auto-add-creator in workspace creation:** The `await upsertWorkspaceMember(...)` line in `POST /api/orgs/:orgId/workspaces` that adds the creator as `maintainer` is removed — org members now have automatic contributor access; org admins already have implicit maintainer via `isOrgAdmin`.

**Remove now-unused imports:** `listWorkspaceMembersWithUsers`, `getWorkspaceMember`, `upsertWorkspaceMember`, `removeWorkspaceMember`, `updateWorkspaceMemberRole`, `makeRequireWorkspacePermission`.

**`GET /api/workspaces` — flatten for all members:**
Remove the non-admin branch that calls `listWorkspacesForUser`. Both org members and admins now call `listWorkspacesForOrg`. Role/permissions are derived:
- Org admin / platform admin → `maintainer` role, full `roleGrants("maintainer")` permissions
- Regular org member → `contributor` role, `roleGrants("contributor")` permissions

### `packages/identity/src/authz.ts` — `loadWorkspaceAccess`

Change the `member` derivation: if no `ws_role` row exists but an `org_role` row does (the user is an org member), synthesise a `contributor` member:

```typescript
const member: WorkspaceMemberLike | null = row.ws_role
  ? { role: row.ws_role as WorkspaceRole, permissions: row.ws_permissions ?? null }
  : row.org_role
    ? { role: "contributor" as WorkspaceRole, permissions: null }
    : null;
```

This means `evaluateCan` receives a non-null `member` for all org members, granting them contributor-level workspace access without explicit `jm_workspace_members` rows.

## Data Flow After Change

```
User authenticates → org membership confirmed (jm_memberships)
                   ↓
loadWorkspaceAccess query
  isOrgAdmin=true  → evaluateCan grants maintainer
  isOrgAdmin=false, org_role='member' → member={role:'contributor'} → evaluateCan grants contributor
  no org membership at all → member=null → 403
```

Existing `jm_workspace_members` rows become inert — they still exist in the DB but are no longer the determining factor for workspace access. They are read by `loadWorkspaceAccess` (and would take precedence over the fallback if present), but since no new rows are written and no UI exposes them, they effectively do nothing.

## Access Control Summary

| Actor | Workspace access | How |
|---|---|---|
| Platform admin | Full (maintainer) | `isPlatformAdmin` in `evaluateCan` |
| Org admin | Full (maintainer) | `isOrgAdmin` in `evaluateCan` |
| Org member | Contributor | `member={role:'contributor'}` fallback in `loadWorkspaceAccess` |
| Non-org user | None | `member=null`, `isOrgAdmin=false` → 403 |

## Testing

- `loadWorkspaceAccess` returns `member: { role: "contributor" }` for a user with only an org membership row and no workspace membership row.
- `GET /api/workspaces` returns all org workspaces for a regular org member with contributor role/permissions.
- Workspace creation no longer inserts into `jm_workspace_members`.
- Frontend: workspace detail page renders Overview and Settings tabs only; no Members tab. Sidebar workspace group has no Members item.
- TypeCheck: `npx tsc --noEmit -p packages/web` and `npx tsc --noEmit -p packages/identity` both pass.
