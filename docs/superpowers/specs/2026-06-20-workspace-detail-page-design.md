# Workspace detail page — design

**Date:** 2026-06-20
**Status:** Approved (pending spec review)

## Problem

Workspace member management lives on a standalone page (`/workspaces/:wsId/members`,
`WorkspaceMembersPage`) that is separate from where org admins manage workspaces
(`OrgWorkspacesPage`, `/orgs/:orgId/workspaces`). There is no per-workspace "view" page —
the workspaces list only creates and deletes. Associating users to a workspace is therefore
disconnected from the org-admin workflow of managing workspaces.

Super admins (`isPlatformAdmin`) and org admins (`role === "admin"`) should be able to open a
workspace from the org's workspaces list and manage it — including associating org users to the
workspace — from a single detail page with tabs.

## Goals

- Clicking a workspace in `OrgWorkspacesPage` opens a **workspace detail page** with tabs.
- Tabs: **Overview**, **Members**, **Settings**.
- The **Members** tab is the existing workspace-member management UI, re-homed here, used to
  associate org users to the workspace and set their workspace role.
- The **Settings** tab supports rename, slug editing, and a Danger Zone delete.
- Access is **org admin + super admin only** (matches the workspaces list guard).

## Non-goals

- Preserving the maintainer's standalone member-management page. The standalone
  `/workspaces/:wsId/members` route is removed; member management moves to the org-admin detail
  page. (Decision: org admin + super admin only.)
- Resource counts (workflows/agents/etc.) on the Overview tab — would require new aggregation
  endpoints. Deferred.
- Per-member custom permissions (the unused `permissions` column on `jm_workspace_members`).
- Schema/migration changes. The `name` and `slug` columns already exist on `jm_workspaces`.

## Approach

**Org-scoped route with self-contained data fetching** (chosen over reusing `WorkspaceProvider`
or a slide-over drawer).

- New route `/orgs/:orgId/workspaces/:wsId`, gated by the same org-admin guard as the workspaces
  list. It fetches its own workspace + members data and does **not** depend on `WorkspaceContext`
  (which is designed for a member navigating *inside* a workspace; our access model here is
  org-admin-only).
- Tabs are nested routes for deep-linking, presented as a **left sub-nav** (standard
  settings-page layout):
  - `/orgs/:orgId/workspaces/:wsId` → redirect to `…/overview`
  - `…/overview`
  - `…/members`
  - `…/settings`

## Components

### Routing & navigation

- `OrgWorkspacesPage` rows become clickable → navigate to `/orgs/:orgId/workspaces/:wsId`.
- New `WorkspaceDetailPage` (`packages/web/src/routes/WorkspaceDetailPage.tsx`):
  - Header band: workspace initials avatar, name, slug (mono), member count, created date,
    breadcrumb back to Workspaces.
  - Left sub-nav with Overview / Members / Settings.
  - Renders the active tab via nested routes.
- Route registration in `packages/web/src/App.tsx` under the org-admin area, guarded by
  `role === "admin"` / `isPlatformAdmin` (same pattern as `OrgWorkspacesPage`).
- **Remove** the standalone `/workspaces/:wsId/members` route and `WorkspaceMembersPage`. Its UI
  is extracted into a reusable panel (below).

### Members tab — `WorkspaceMembersPanel`

- Extract today's `WorkspaceMembersPage` logic into
  `packages/web/src/components/WorkspaceMembersPanel.tsx` (or similar), taking `orgId` + `wsId`
  as props from route params. **No `WorkspaceContext` dependency** — access is gated at the page.
- Behavior (unchanged from today):
  - List workspace members; search box to filter.
  - "Add member" opens a modal: pick an org user not already in the workspace + choose a role,
    then add.
  - Inline role select per member (maintainer / contributor / observer).
  - Remove member (Danger-styled icon button).
- Endpoints (all existing — org admins already satisfy the `members.manage` guard via implicit
  maintainer in `evaluateCan`):
  - `GET /api/workspaces/:wsId/members` — list
  - `GET /api/orgs/:orgId/users` — populate the add-member picker (filter out current members)
  - `POST /api/workspaces/:wsId/members` — add with role
  - `PATCH /api/workspaces/:wsId/members/:userId` — change role
  - `DELETE /api/workspaces/:wsId/members/:userId` — remove

### Overview tab

- Read-only summary: name, slug, created date, member count.
- Sourced from the new single-workspace GET + the members list count.

### Settings tab

- **Edit form**: rename (display name) + edit slug.
  - Slug validated for uniqueness within the org (server-side); client shows the error.
  - Note: routes reference workspaces by `wsId` (UUID), not slug, so editing the slug does not
    break navigation.
- **Danger Zone** section at the bottom: delete workspace (moved off `OrgWorkspacesPage`).
  - Keeps the existing guard against deleting the `default` workspace.

### New backend (`packages/identity/src/routes/workspaces.ts`)

Only two additions; both org-admin guarded (`requireAuth({ role: "admin" })`), matching the
existing org-scoped workspace routes:

- `GET /api/orgs/:orgId/workspaces/:wsId` — fetch one workspace (name, slug, created_at) for the
  detail page. Returns 404 if not in the org.
- `PATCH /api/orgs/:orgId/workspaces/:wsId` — update `name` and/or `slug`.
  - Validates slug uniqueness within the org; returns 409 on conflict.
  - No schema/migration change (columns exist).
  - Returns the updated workspace record.

## Data flow

1. Org admin opens `/orgs/:orgId/workspaces` → clicks a row → `/orgs/:orgId/workspaces/:wsId`.
2. `WorkspaceDetailPage` loads the workspace via `GET /api/orgs/:orgId/workspaces/:wsId` and
   renders the header + left sub-nav; default tab redirects to Overview.
3. **Members tab**: `WorkspaceMembersPanel` lists members and loads org users for the add picker;
   add/role-change/remove hit the existing workspace member endpoints.
4. **Settings tab**: edit form PATCHes the workspace; Danger Zone delete calls the existing
   `DELETE /api/orgs/:orgId/workspaces/:wsId`, then navigates back to the list.

## Access control

- UI: detail page and all tabs gated by org-admin (`role === "admin"`) or super admin
  (`isPlatformAdmin`), same as `OrgWorkspacesPage`.
- API: new `GET`/`PATCH` use `requireAuth({ role: "admin" })`. Existing member endpoints keep
  their `members.manage` guard (org admins pass it via implicit maintainer). Tightening the
  member endpoints to org-admin-only is out of scope — the UI no longer exposes them to
  non-admins, and the backend behavior is unchanged.

## Error handling

- `GET` single workspace: 404 if the workspace is not in the org → detail page shows a
  not-found state.
- `PATCH` slug conflict: 409 → Settings form shows an inline "slug already in use" error.
- Delete of the `default` workspace: blocked by the existing guard → surfaced as an error toast;
  the delete control is disabled/hidden for the default workspace.
- Member operations: reuse the existing page's error handling (surface API errors inline/toast).

## Testing

- Backend (`packages/identity`): `GET /api/orgs/:orgId/workspaces/:wsId` returns the workspace
  for an org admin and 404 for a workspace outside the org; non-admin is rejected. `PATCH`
  updates name/slug, rejects a duplicate slug within the org (409), and is rejected for
  non-admins.
- Frontend: `WorkspaceMembersPanel` renders with `orgId`/`wsId` props and performs
  add/role-change/remove against the existing endpoints; `WorkspaceDetailPage` redirects the
  index route to Overview and gates on org-admin.

## Open decisions (resolved)

- Two member pages → fold standalone workspace-members page into the detail Members tab.
- Tabs → Overview, Members, Settings (Danger Zone as a section within Settings).
- Access → org admin + super admin only.
- Settings scope → rename + slug + delete (adds `PATCH` endpoint; no migration).
- Tab presentation → left sub-nav (standard settings layout), nested routes.
