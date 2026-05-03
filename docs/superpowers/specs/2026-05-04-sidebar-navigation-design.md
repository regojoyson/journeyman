# Sidebar Navigation Design

**Date:** 2026-05-04
**Status:** Approved

## Summary

Replace the current horizontal top-header navigation bar in `AppShell` with a collapsible sidebar. The sidebar uses a hover-to-expand rail with a pin button to lock it open.

## Current State

`packages/web/src/components/AppShell.tsx` renders a horizontal `<nav>` bar at the top with all navigation links inline (Flows, Runs, My Secrets, My MCPs, and up to 4 admin links). As the number of links grows (especially for admins), the header becomes cluttered.

## Design

### Layout

- The top `<nav>` header is **removed entirely**.
- The app layout becomes a horizontal flex row: `<Sidebar> + <main>`.
- `<main>` takes `flex: 1`, height `100vh`, overflow hidden — same behaviour as today minus the 41px header offset.

### Sidebar States

| State | Width | Trigger |
|---|---|---|
| Collapsed (default) | 52px | No interaction |
| Expanded (hover) | 160px | Mouse enters sidebar |
| Expanded (pinned) | 160px | User clicks pin button |

- Transition between collapsed and expanded uses a **200ms CSS width transition** (`ease-in-out`).
- In collapsed state only icons are visible; labels are hidden with `overflow: hidden` / `opacity: 0`.
- In expanded state icons + text labels are visible side by side.
- Pinned state is persisted in `localStorage` under the key `sidebar-pinned`.

### Navigation Items

**Standard (all users):**
| Label | Route |
|---|---|
| Flows | `/flows` |
| Runs | `/runs` |
| My Secrets | `/me/secrets` |
| My MCPs | `/me/mcps` |

**Admin section** (only rendered when `role === "admin"`, separated by a labelled divider):
| Label | Route |
|---|---|
| Users | `/admin/users` |
| Org Secrets | `/admin/secrets` |
| Org MCPs | `/admin/mcps` |
| Admin Flows | `/admin/flows` |

### Pin Button

- Rendered in the top-right corner of the expanded sidebar.
- Icon: a small pin/pushpin glyph (or chevron-left).
- Clicking it toggles `pinned` state and writes to `localStorage`.
- When pinned, hovering out does not collapse the sidebar.
- When unpinned, mouse-leave collapses back to 52px.

### User Profile

- Moves from the header to the **bottom of the sidebar**.
- Collapsed: shows avatar initials circle only (30×30px).
- Expanded: shows avatar + display name + role badge.
- Clicking it opens the same dropdown menu (My Secrets, My MCPs, Change password, Sign out) — positioned above the avatar button.

### Brand

- Collapsed: `◆` glyph only, centred.
- Expanded: `◆ Journeyman` text.

## Component Structure

```
AppShell.tsx
  <div style="display:flex;height:100vh">
    <Sidebar />           ← new component
    <main style="flex:1;overflow:hidden">
      <Outlet />
    </main>
  </div>

packages/web/src/components/Sidebar.tsx   ← new file
  - manages expanded/pinned state
  - renders nav items, admin section, user profile button
  - uses existing useAuth() for role + user info
```

`AppShell.tsx` is simplified to just the flex wrapper + `<Outlet>`. All sidebar logic lives in `Sidebar.tsx`.

## State Management

| State | Type | Source |
|---|---|---|
| `expanded` | `boolean` | `useState` — true when hovered or pinned |
| `pinned` | `boolean` | `useState` initialised from `localStorage['sidebar-pinned']` |

No global state or context needed — sidebar is self-contained.

## Styling

- Follows existing inline-style + Tailwind pattern used in `AppShell.tsx`.
- Background: `#11111a`, border-right: `1px solid #2a2a3a` — matches existing header colours.
- Active nav item: `background: #4a9eff22`, `color: #4a9eff`, `fontWeight: 600`.
- Inactive nav item: `color: #777`, hover `color: #ccc`.
- No external icon library — use simple unicode symbols consistent with the existing `◆` brand glyph in `AppShell.tsx`.

## Files Changed

| File | Change |
|---|---|
| `packages/web/src/components/AppShell.tsx` | Remove `<nav>` block, change root to flex row, adjust `<main>` height |
| `packages/web/src/components/Sidebar.tsx` | **New file** — full sidebar component |
