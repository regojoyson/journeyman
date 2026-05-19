# Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the horizontal top-nav bar in `AppShell` with a collapsible hover-to-expand sidebar rail with a pin button.

**Architecture:** A new `Sidebar.tsx` component owns all sidebar state (hover, pinned, user menu). `AppShell.tsx` is stripped to a flex row wrapper containing `<Sidebar>` and `<main>`. No global state needed — sidebar is fully self-contained.

**Tech Stack:** React 18, React Router v7, TypeScript, inline styles + Tailwind (existing pattern), `localStorage` for pin persistence.

---

## File Map

| File | Action |
|---|---|
| `packages/web/src/components/Sidebar.tsx` | **Create** — full sidebar component |
| `packages/web/src/components/AppShell.tsx` | **Modify** — strip to flex wrapper, import Sidebar |

---

### Task 1: Create `Sidebar.tsx`

**Files:**
- Create: `packages/web/src/components/Sidebar.tsx`

- [ ] **Step 1: Create the file with all imports and static data**

```tsx
import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../AuthContext.tsx";

const NAV_ITEMS = [
  { to: "/flows",       icon: "⚡", label: "Flows"      },
  { to: "/runs",        icon: "▶",  label: "Runs"       },
  { to: "/me/secrets",  icon: "🔑", label: "My Secrets" },
  { to: "/me/mcps",     icon: "🔌", label: "My MCPs"    },
];

const ADMIN_ITEMS = [
  { to: "/admin/users",   icon: "👥", label: "Users"       },
  { to: "/admin/secrets", icon: "🔐", label: "Org Secrets" },
  { to: "/admin/mcps",    icon: "🧩", label: "Org MCPs"    },
  { to: "/admin/flows",   icon: "📋", label: "Admin Flows" },
];

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
```

- [ ] **Step 2: Add the component function with state and derived values**

Append to the same file:

```tsx
export default function Sidebar() {
  const { role, user, org, logout } = useAuth();
  const [pinned, setPinned] = useState(
    () => localStorage.getItem("sidebar-pinned") === "true"
  );
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const expanded = pinned || hovered;

  const label = user?.displayName?.trim() || user?.username || "?";
  const subtitle = [org?.name ?? org?.slug, role].filter(Boolean).join(" • ");
```

- [ ] **Step 3: Add effects for pin persistence and user-menu close-on-outside-click**

Append inside the component, after the derived values:

```tsx
  useEffect(() => {
    localStorage.setItem("sidebar-pinned", String(pinned));
  }, [pinned]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);
```

- [ ] **Step 4: Add the `navStyle` helper**

Append inside the component:

```tsx
  const navStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: expanded ? "7px 14px" : "7px 0",
    justifyContent: expanded ? "flex-start" : "center",
    borderRadius: 6,
    textDecoration: "none",
    color: isActive ? "#4a9eff" : "#777",
    background: isActive ? "#4a9eff22" : "transparent",
    fontWeight: isActive ? 600 : 400,
    fontSize: 13,
    transition: "color 0.15s, background 0.15s",
  });
```

- [ ] **Step 5: Add the return JSX — outer shell and brand row**

Append inside the component:

```tsx
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: expanded ? 160 : 52,
        minWidth: expanded ? 160 : 52,
        height: "100vh",
        background: "#11111a",
        borderRight: "1px solid #2a2a3a",
        display: "flex",
        flexDirection: "column",
        alignItems: expanded ? "stretch" : "center",
        padding: "10px 0",
        transition: "width 0.2s ease-in-out, min-width 0.2s ease-in-out",
        overflow: "hidden",
        flexShrink: 0,
        position: "relative",
        zIndex: 20,
      }}
    >
      {/* Brand + pin */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: expanded ? "space-between" : "center",
        padding: expanded ? "0 10px 10px 12px" : "0 0 10px",
        flexShrink: 0,
      }}>
        <Link
          to="/"
          style={{ color: "#4a9eff", fontWeight: 700, textDecoration: "none", fontSize: 13, whiteSpace: "nowrap" }}
        >
          {expanded ? "◆ Journeyman" : "◆"}
        </Link>
        {expanded && (
          <button
            type="button"
            onClick={() => setPinned(p => !p)}
            title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
            style={{
              background: "#4a9eff22",
              border: "none",
              borderRadius: 4,
              width: 20,
              height: 20,
              cursor: "pointer",
              color: "#4a9eff",
              fontSize: 11,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {pinned ? "✕" : "📌"}
          </button>
        )}
      </div>
```

- [ ] **Step 6: Add nav items and admin section JSX**

Append inside the `return`, after the brand row:

```tsx
      {/* Nav items */}
      <nav style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: expanded ? "0 6px" : "0 8px",
        flex: 1,
      }}>
        {NAV_ITEMS.map(({ to, icon, label: itemLabel }) => (
          <NavLink key={to} to={to} style={navStyle}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
            {expanded && (
              <span style={{ whiteSpace: "nowrap", overflow: "hidden" }}>{itemLabel}</span>
            )}
          </NavLink>
        ))}

        {role === "admin" && (
          <>
            <div style={{ borderTop: "1px solid #2a2a3a", margin: "6px 0" }} />
            {expanded && (
              <div style={{
                padding: "2px 8px 4px",
                color: "#444",
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}>
                Admin
              </div>
            )}
            {ADMIN_ITEMS.map(({ to, icon, label: itemLabel }) => (
              <NavLink key={to} to={to} style={navStyle}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
                {expanded && (
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden" }}>{itemLabel}</span>
                )}
              </NavLink>
            ))}
          </>
        )}
      </nav>
```

- [ ] **Step 7: Add user profile section JSX and close the component**

Append inside the `return`, after the nav, then close the outer `<div>` and the function:

```tsx
      {/* User profile */}
      <div
        ref={menuRef}
        style={{
          padding: expanded ? "8px 8px 0" : "8px 0 0",
          borderTop: "1px solid #1e1e2e",
          position: "relative",
        }}
      >
        {menuOpen && (
          <div
            role="menu"
            style={{
              position: "absolute",
              bottom: "100%",
              left: expanded ? 8 : "50%",
              transform: expanded ? "none" : "translateX(-50%)",
              marginBottom: 6,
              width: 220,
              background: "#0f0f1a",
              border: "1px solid #2a2a3a",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              zIndex: 50,
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "10px 12px", borderBottom: "1px solid #1e1e2e" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{label}</div>
              {user?.username && user?.displayName && (
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>@{user.username}</div>
              )}
              {subtitle && (
                <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{subtitle}</div>
              )}
            </div>
            {[
              { to: "/me/secrets",  label: "My Secrets"      },
              { to: "/me/mcps",     label: "My MCPs"         },
              { to: "/me/password", label: "Change password" },
            ].map(({ to, label: itemLabel }) => (
              <Link
                key={to}
                to={to}
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                style={{ display: "block", padding: "8px 12px", fontSize: 13, color: "#cbd5e1", textDecoration: "none" }}
                className="hover:bg-slate-800"
              >
                {itemLabel}
              </Link>
            ))}
            <button
              type="button"
              role="menuitem"
              onClick={() => { setMenuOpen(false); void logout(); }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                fontSize: 13,
                color: "#fca5a5",
                background: "none",
                border: "none",
                borderTop: "1px solid #1e1e2e",
                cursor: "pointer",
              }}
              className="hover:bg-rose-950/40"
            >
              Sign out
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setMenuOpen(o => !o)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: expanded ? "4px" : "0",
            background: "none",
            border: "none",
            cursor: "pointer",
            width: expanded ? "100%" : "auto",
            borderRadius: 6,
          }}
        >
          <div style={{
            width: 30,
            height: 30,
            background: "#5555aa44",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#8888cc",
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}>
            {initials(label)}
          </div>
          {expanded && (
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#cbd5e1", whiteSpace: "nowrap" }}>{label}</div>
              {role && <div style={{ fontSize: 10, color: "#64748b" }}>{role}</div>}
            </div>
          )}
        </button>
      </div>
    </div>
  );
}
```

---

### Task 2: Update `AppShell.tsx`

**Files:**
- Modify: `packages/web/src/components/AppShell.tsx`

The current `AppShell.tsx` (~135 lines) contains the full nav bar, user-menu dropdown, and profile logic. All of that moves to `Sidebar.tsx`. The new file is a thin layout wrapper.

- [ ] **Step 1: Replace the entire contents of `AppShell.tsx`**

```tsx
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.tsx";

export default function AppShell() {
  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <Sidebar />
      <main style={{ flex: 1, overflow: "hidden" }}>
        <Outlet />
      </main>
    </div>
  );
}
```

> **Note:** The `initials` helper, `useAuth` import, and all nav/dropdown JSX are no longer needed in this file — they live in `Sidebar.tsx`.

---

### Task 3: Typecheck

**Files:** (read-only verification)

- [ ] **Step 1: Run typecheck for the web package**

```bash
cd packages/web && npm run typecheck
```

Expected: no errors. If errors appear, fix them before considering the work done. Common issues:
- `React.CSSProperties` not in scope — add `import type React from "react"` or use the existing `React` namespace (already available via `@types/react`).
- `navStyle` closure captures `expanded` — TypeScript may flag a stale-closure warning; it won't because `expanded` is a derived `const`, not a `useState`.
- If `user?.displayName` or `org?.name` types don't match — check `AuthContext.tsx` for the exact shape and adjust field access accordingly.

- [ ] **Step 2: Run root-level typecheck to confirm no other packages broke**

```bash
npm run typecheck
```

Expected: all packages pass.
