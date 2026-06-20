# Add-member dialog & Danger Zone restyle — design

**Date:** 2026-06-20
**Status:** Approved (pending spec review)

## Problem

Two UI issues on the workspace detail page (built in
`2026-06-20-workspace-detail-page-design.md`):

1. **Members tab** fetches the **entire org user list on mount** (alongside the member list) and
   renders an always-visible inline "add" form. The org user list should load lazily, and adding a
   member should happen through a dedicated, well-designed dialog opened from an "Add member"
   button.
2. **Danger Zone delete** button in the Settings tab looks weak / unstyled. It needs a clearer
   visual treatment.

## Goals

- Members tab loads only the member list on mount; org users load **on demand** when the add
  dialog opens.
- An **"Add member"** button in the Members header opens a modal dialog with a searchable user
  picker, a role selector, and an add action (one user at a time).
- Restyle the Danger Zone delete into a clear red-bordered card with a properly-styled delete
  button and a stronger confirm action.

## Non-goals

- Bulk add (multiple users at once). Decided: one at a time.
- Any backend change. Reuses existing endpoints (`listMembers`, `listOrgUsers`, `addMember`,
  `setMemberRole`, `removeMember`, workspace `remove`).
- Changing the confirm-to-delete mechanism (still type the workspace **name**).
- Changing role semantics or the inline role-change / remove controls in the members table.

## Part 1 — Add member: button + lazy-loaded dialog

### Behavior change in `WorkspaceMembersPanel`

File: `packages/web/src/components/WorkspaceMembersPanel.tsx`

- On mount, `refresh()` fetches **only** `workspaceAdminApi.listMembers(wsId)` for the table. It no
  longer calls `listOrgUsers(orgId)`. The `orgUsers`/`addUserId`/`addRole`/inline-form state and the
  always-visible "Add a member" `<section>` are removed from the panel.
- The members `<section>` header gains an **"Add member"** button (top-right of the card header),
  styled with the primary button class + a `ti`/emoji add affordance consistent with the codebase.
- Panel owns `addOpen: boolean` state. The button sets `addOpen = true`.
- Renders `<AddMemberDialog>` when `addOpen` is true, passing `orgId`, `wsId`, the current
  `members` (so it can exclude existing members), an `onAdded` callback (calls `refresh()` to
  reload the table), and an `onClose` callback (sets `addOpen = false`).

### New component `AddMemberDialog`

File (new): `packages/web/src/components/AddMemberDialog.tsx`

Props:
```ts
{
  orgId: string;
  wsId: string;
  existingMemberIds: Set<string>;   // or string[] mapped to a Set internally
  onAdded: () => void | Promise<void>;
  onClose: () => void;
}
```

- Centered modal overlay, matching the existing pattern (fixed inset, `bg-black/60`, click-outside
  to close when not busy, inner card uses `card` + `max-w-md`). Mirrors the delete-confirm modal
  that previously lived in `OrgWorkspacesPage`.
- **On open** (mount), fetches `listOrgUsers(orgId)`:
  - loading state: a centered "Loading…" line inside the list area.
  - on error: inline error message + a retry affordance (or just the error text; retry optional).
- Computes the addable list = org users whose `id` is not in `existingMemberIds`.
- **Search**: a text input filters the addable list case-insensitively by `username` and
  `displayName`.
- **List**: scrollable (max-height ~200px), each row = avatar/initials + username + displayName.
  Clicking a row selects it (single select; selected row highlighted with a check). Selection held
  in `selectedUserId` state.
- **Role**: a `<select>` (maintainer / contributor / observer), default `contributor`.
- **Footer**: `Cancel` (calls `onClose`) and `Add to workspace` (disabled until a user is selected
  or while busy).
- **Add action**: `await workspaceAdminApi.addMember(wsId, { userId: selectedUserId, role })`, then:
  - `await onAdded()` (parent refreshes the table),
  - clear `selectedUserId` (keep the dialog open so the user can add another),
  - the just-added user drops out of the addable list automatically once the parent re-renders the
    dialog with the updated `existingMemberIds` **OR** the dialog locally tracks added ids. To keep
    data flow simple: the dialog maintains a local `addedIds: Set<string>` and excludes both
    `existingMemberIds` and `addedIds` from the addable list, so the row disappears immediately
    without depending on parent re-render timing.
  - on error: inline error in the dialog; dialog stays open.
- **Empty states**:
  - addable list empty (all org users already members): "All org users are already members."
  - search yields nothing: "No users match."

### Data flow

1. Members tab mounts → `WorkspaceMembersPanel.refresh()` → `listMembers(wsId)` → table renders.
   No org-user fetch.
2. User clicks "Add member" → `AddMemberDialog` mounts → `listOrgUsers(orgId)` fetched once.
3. Select user + role → `addMember` → `onAdded()` refreshes the table; user removed from the
   dialog's addable list via `addedIds`.
4. Close → dialog unmounts.

## Part 2 — Danger Zone restyle

File: `packages/web/src/routes/workspace-detail/SettingsTab.tsx`

- The Danger Zone `<section>` becomes a card with a **red border** (`border-destructive` / the
  existing red border token already used — `border-red-900/50` is acceptable; prefer a destructive
  border token if one exists in `admin-styles`/theme).
- **Resting state**: a row with title ("Delete this workspace") + one-line description on the left,
  and a **Delete workspace** button on the right styled with a red border + trash icon
  (`btnDanger`, ensured to render as an outlined red button).
- **Confirm state** (after clicking Delete): the type-the-name input (`Type <name> to confirm`) and
  a **filled red** Delete button (stronger affordance — filled danger background) next to Cancel.
  Reuses the existing `confirming` / `confirmName` state and `confirmDelete()` logic unchanged.
- Default workspace: the Delete button stays disabled with the existing tooltip when
  `workspace.slug === "default"`.
- Styling uses existing theme classes/tokens; if the precise "filled red" and "outlined red"
  variants don't both exist in `admin-styles.ts`, add the missing variant there (small, local) so
  the buttons are reusable and consistent.

## Error handling

- Dialog: fetch failure → inline error; add failure → inline error, dialog stays open. Busy state
  disables Add/Cancel during the request.
- Delete: existing 409 ("default can't be deleted") and generic error handling unchanged.

## Testing

- This is presentational React with no new logic branches beyond lazy fetch + filter. Verification
  is by typecheck (`npm run typecheck`) and manual check in the running app. No new unit tests
  required (consistent with the existing members UI, which has none). If a pure helper is extracted
  (e.g. a `filterAddableUsers(users, existingIds, query)` function), add a small Vitest unit test
  for it.

## Components touched

- Modify: `packages/web/src/components/WorkspaceMembersPanel.tsx` — drop upfront org-user fetch +
  inline form; add "Add member" button + `addOpen` state + dialog mount.
- Create: `packages/web/src/components/AddMemberDialog.tsx` — searchable picker dialog, lazy fetch.
- Modify: `packages/web/src/routes/workspace-detail/SettingsTab.tsx` — restyle Danger Zone.
- Possibly modify: `packages/web/src/routes/admin-styles.ts` — add a filled-danger button variant if
  not already present.

## Open decisions (resolved)

- Add flow → one user at a time.
- Org users → fetched on dialog open, not on panel mount.
- Add UI → centered modal dialog with searchable list.
- Dialog stays open after each add (clears selection, removes added user from list).
- Confirm-to-delete → still type the workspace name.
