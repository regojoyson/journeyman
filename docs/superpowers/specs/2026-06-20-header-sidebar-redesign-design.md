# Header + Sidebar Redesign

**Date:** 2026-06-20
**Status:** Design — approved, pending implementation plan
**Scope:** `@journeyman/web` UI relayout only. No backend, route, or API changes.

## Summary

Introduce a top header bar and move the workspace switcher, theme toggle, and
user profile out of the sidebar into it. Rework the sidebar into pure,
grouped navigation with search and an explicit collapse control.

Today there is no header: `AppShell` is a horizontal split of `Sidebar` +
`main`. The `Sidebar` carries the logo, a pin toggle, the workspace switcher,
the nav list, the profile menu, and the theme toggle — and uses a
hover-to-expand + pin mechanic. This redesign separates global/account
controls (→ header) from navigation (→ sidebar).

## Goals

- Header bar across the top of the app.
- Workspace switcher and profile both in the header's top-right (per request).
- Theme toggle relocated to the header.
- Sidebar becomes navigation-only: search, collapsible groups, explicit
  collapse-to-rail.

## Non-Goals

- Command palette (search only filters visible nav items).
- Breadcrumbs in the header.
- Mobile / responsive drawer behavior.
- Any backend, route, permission, or API change.

## Layout

```
┌─────────────────────────────────────────────┐
│  HEADER   logo · · · · · · · · ·  [cluster]   │  full width, fixed height
├──────────┬──────────────────────────────────┤
│ SIDEBAR  │  main (<Outlet/>)                 │
│  (nav)   │                                   │
└──────────┴──────────────────────────────────┘
```

`AppShell` becomes a vertical flex column: `<Header />` on top, then a
horizontal flex row of `<Sidebar />` + `<main>` filling the remaining height.

## Components

### `AppShell.tsx` (modified)

```
<div style={{ display:"flex", flexDirection:"column", height:"100vh" }}>
  <Header />
  <div style={{ display:"flex", flex:1, overflow:"hidden" }}>
    <Sidebar />
    <main style={{ flex:1, overflow:"hidden" }}><Outlet /></main>
  </div>
</div>
```

### `Header.tsx` (new)

- Fixed height (~48px), `borderBottom`, `background: --color-surface`, full width.
- **Left:** Journeyman `Logo` (the full logo, relocated from the sidebar),
  wrapped in a `<Link to="/">`.
- **Right cluster** (`marginLeft: auto`), all rendered as **ghost buttons** —
  no border at rest, soft `--color-surface`/hover background on `:hover`,
  rounded corners:
  1. `WorkspaceSwitcher` (header variant) — workspace avatar + name + caret.
  2. `ThemeToggle` (from `@journeyman/theme`) — relocated from sidebar.
  3. `ProfileMenu` (new) — user avatar + caret.

### `WorkspaceSwitcher.tsx` (modified)

- Currently takes `expanded: boolean` (sidebar context). Add a `variant`
  (`"sidebar" | "header"`) or replace the prop set so it can render as a
  borderless ghost button in the header.
- Header variant: no full-width box border; avatar + name + caret, soft hover
  highlight. Dropdown opens **downward** (`top: 100%`), right-aligned under the
  button.
- Behavior unchanged: selecting a workspace calls `setActiveWorkspaceId` and
  navigates to `/workspaces/:id/workflows`. Single-workspace stays static (no
  caret, not clickable).

### `ProfileMenu.tsx` (new — extracted from `Sidebar`)

- Ghost button: circular avatar with user initials + caret.
- Click opens a downward dropdown containing:
  - user info block (display name, `@username`, `org • role` subtitle),
  - "Change password" → `/me/password`,
  - "Sign out" → `logout()`.
- Reuses the existing `initials()` helper (move into this component or a shared
  util). Closes on outside-click (existing `mousedown` listener pattern).

### `Sidebar.tsx` (rewritten)

Navigation only. Removed: logo/pin block, embedded `WorkspaceSwitcher`,
profile block, theme toggle (all now in the header).

- **Search box** at the top: a text input that filters nav items by label
  (case-insensitive substring). `⌘K` / `Ctrl+K` focuses it (global key
  listener). Groups with no matching items hide while filtering. Clearing
  restores the full list. *Not* a command palette.
- **Collapsible groups** — today's flat list regrouped:

  | Group | Items |
  |---|---|
  | **Workspace** | Workflows, Workflow Instances, Agents, Custom Steps, Members* |
  | **Integrations** | Connections, MCPs, Skills, Webhooks, Secrets |
  | **Organization** (admin only) | Workspaces, Members, Org Secrets, Org Sandboxes, Coding Models |

  \* Workspace "Members" link stays gated behind `can("members.manage")`.
  Organization group stays gated behind `isAdmin && activeOrgId` (unchanged
  conditions, just regrouped). Workspace/Integrations groups only render when
  `activeWorkspaceId` is set, as today.

  Each group has a clickable header that folds/unfolds its items (chevron
  ▾/▸). Per-group fold state persists in `localStorage`
  (e.g. key `sidebar-group-<name>`).

- **Collapse control** — a button that toggles the whole sidebar between
  **expanded** (full width ~200px, labels + group headers + search visible) and
  **rail** (~54px, icons only). Collapsed state persists in `localStorage`
  (e.g. `sidebar-collapsed`), replacing the old `sidebar-pinned` key and the
  hover-to-expand mechanic.
  - In rail mode: group headers and search input are hidden; search renders as
    an icon button that expands the sidebar (and focuses search). Items show
    icon only, with `title` tooltips.

- Item routing unchanged: workspace/integration items →
  `/workspaces/:activeWorkspaceId/<slug>`; org items → `/orgs/:activeOrgId/<slug>`.
  Active state via `NavLink` styling as today.

## Data / State

- No new data sources. Uses existing `useAuth()` (`role`, `user`, `org`,
  `isPlatformAdmin`, `activeOrgId`, `logout`) and `useWorkspace()`
  (`workspaces`, `activeWorkspace`, `activeWorkspaceId`, `setActiveWorkspaceId`,
  `can`).
- New client-only persisted UI state in `localStorage`:
  `sidebar-collapsed` (bool), `sidebar-group-<name>` (bool per group).

## Styling

- Reuse existing CSS variables (`--color-surface`, `--color-border`,
  `--color-text`, `--color-text-subtle`, `--accent`, `--accent-foreground`,
  `--color-danger`, etc.) — consistent with current sidebar.
- Ghost button pattern: `background: transparent` at rest; on hover a subtle
  `--color-bg`/surface tint and `borderRadius`. No persistent borders in the
  header cluster.
- Dropdowns: existing card style (`--color-bg` background, `--color-border`,
  rounded, soft shadow), opening downward in the header.

## Error / Edge Handling

- Single workspace → switcher is static (no dropdown), as today.
- No workspaces → switcher renders nothing (as today); sidebar shows only the
  Organization group if admin.
- Non-admin / no `activeOrgId` → Organization group omitted.
- Search with no matches → groups collapse to empty; show a faint "No matches"
  line.
- All dropdowns close on outside-click and on selection.

## Testing

- `AppShell` renders `Header` above the `Sidebar` + `main` row.
- `Header` shows logo (left) and workspace switcher + theme toggle + profile
  (right).
- `ProfileMenu` opens/closes, shows user info, navigates to change-password,
  calls `logout`.
- `WorkspaceSwitcher` header variant: lists workspaces, selects + navigates;
  static when single workspace.
- `Sidebar`: groups render correct items per role/workspace conditions; group
  fold toggles and persists; collapse toggles rail/expanded and persists;
  search filters items and `⌘K` focuses the input.

## Files Touched

- `packages/web/src/components/AppShell.tsx` — modified
- `packages/web/src/components/Header.tsx` — new
- `packages/web/src/components/ProfileMenu.tsx` — new
- `packages/web/src/components/WorkspaceSwitcher.tsx` — modified (header variant)
- `packages/web/src/components/Sidebar.tsx` — rewritten
