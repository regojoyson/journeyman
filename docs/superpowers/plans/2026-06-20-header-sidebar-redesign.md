# Header + Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top header bar carrying the workspace switcher, theme toggle, and profile menu; rework the sidebar into grouped, searchable, collapsible navigation.

**Architecture:** `AppShell` becomes a vertical column (`Header` over a `Sidebar` + `main` row). Global/account controls move from the sidebar into a new `Header`. Pure navigation config and helpers are extracted into a testable `nav-config.ts` module; the sidebar renders from it.

**Tech Stack:** React + TypeScript, react-router-dom (`NavLink`/`Link`/`useNavigate`), Vite, Vitest (node env — tests use pure functions / `renderToStaticMarkup`), existing CSS variables, `localStorage` for UI state.

**Working constraints (per request):** Work on the current `master` branch. **No git commits** — leave changes in the working tree. Run typecheck (and the new unit tests) at the end as the verification gate.

---

## File Structure

- **Create** `packages/web/src/components/nav-config.ts` — pure nav model + helpers (`NAV_GROUPS`, `filterGroups`, `navHref`, `initials`). Single source of truth for sidebar items.
- **Create** `packages/web/src/components/nav-config.test.ts` — unit tests for the pure helpers.
- **Create** `packages/web/src/components/ProfileMenu.tsx` — header profile avatar + dropdown (extracted from `Sidebar`).
- **Create** `packages/web/src/components/Header.tsx` — top bar: logo (left) + workspace switcher, theme toggle, profile (right).
- **Modify** `packages/web/src/components/WorkspaceSwitcher.tsx` — drop the `expanded` sidebar prop; render as a borderless header ghost button with a downward, right-aligned dropdown.
- **Rewrite** `packages/web/src/components/Sidebar.tsx` — navigation only: search (⌘K), collapsible groups from `nav-config`, collapse-to-rail toggle, persisted UI state.
- **Modify** `packages/web/src/components/AppShell.tsx` — vertical column with `Header` on top.

---

## Task 1: Pure navigation config + helpers (TDD)

**Files:**
- Create: `packages/web/src/components/nav-config.ts`
- Test: `packages/web/src/components/nav-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/nav-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NAV_GROUPS, filterGroups, navHref, initials } from "./nav-config.ts";

describe("NAV_GROUPS", () => {
  it("has the three groups in order", () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(["workspace", "integrations", "organization"]);
  });
  it("marks the organization group org-scoped and admin-only", () => {
    const org = NAV_GROUPS.find((g) => g.id === "organization")!;
    expect(org.scope).toBe("org");
    expect(org.adminOnly).toBe(true);
  });
  it("gates the workspace Members item behind members.manage", () => {
    const ws = NAV_GROUPS.find((g) => g.id === "workspace")!;
    expect(ws.items.find((i) => i.slug === "members")?.perm).toBe("members.manage");
  });
});

describe("filterGroups", () => {
  it("returns all groups unchanged for an empty query", () => {
    expect(filterGroups(NAV_GROUPS, "  ")).toEqual(NAV_GROUPS);
  });
  it("keeps only matching items and drops empty groups", () => {
    const result = filterGroups(NAV_GROUPS, "work");
    expect(result.map((g) => g.id)).toEqual(["workspace", "organization"]);
    expect(result[0].items.map((i) => i.slug)).toEqual(["workflows", "workflow-instances"]);
    expect(result[1].items.map((i) => i.slug)).toEqual(["workspaces"]);
  });
  it("is case-insensitive", () => {
    expect(filterGroups(NAV_GROUPS, "AGENTS")[0].items[0].slug).toBe("agents");
  });
});

describe("navHref", () => {
  it("builds workspace-scoped hrefs", () => {
    const ws = NAV_GROUPS[0];
    expect(navHref(ws, ws.items[0], "w1", "o1")).toBe("/workspaces/w1/workflows");
  });
  it("builds org-scoped hrefs", () => {
    const org = NAV_GROUPS.find((g) => g.id === "organization")!;
    expect(navHref(org, org.items[0], "w1", "o1")).toBe("/orgs/o1/workspaces");
  });
});

describe("initials", () => {
  it("uses first+last initials for multi-word", () => {
    expect(initials("Samuel Rego")).toBe("SR");
  });
  it("uses first two letters for a single word", () => {
    expect(initials("acme")).toBe("AC");
  });
  it("falls back to ? for empty", () => {
    expect(initials("  ")).toBe("?");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @journeyman/web -- nav-config`
Expected: FAIL — `Cannot find module './nav-config.ts'`.

- [ ] **Step 3: Write the implementation**

Create `packages/web/src/components/nav-config.ts`:

```ts
export type NavScope = "workspace" | "org";

export type NavItem = {
  slug: string;
  icon: string;
  label: string;
  /** Workspace-scoped permission required to show this item. */
  perm?: "members.manage";
};

export type NavGroup = {
  id: string;
  label: string;
  scope: NavScope;
  /** Only render for org admins / platform admins. */
  adminOnly?: boolean;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
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
  {
    id: "integrations",
    label: "Integrations",
    scope: "workspace",
    items: [
      { slug: "connections", icon: "🔗", label: "Connections" },
      { slug: "mcps", icon: "🔌", label: "MCPs" },
      { slug: "skills", icon: "🎓", label: "Skills" },
      { slug: "webhooks", icon: "📡", label: "Webhooks" },
      { slug: "secrets", icon: "🔑", label: "Secrets" },
    ],
  },
  {
    id: "organization",
    label: "Organization",
    scope: "org",
    adminOnly: true,
    items: [
      { slug: "workspaces", icon: "🗂", label: "Workspaces" },
      { slug: "members", icon: "👥", label: "Members" },
      { slug: "secrets", icon: "🔐", label: "Org Secrets" },
      { slug: "sandboxes", icon: "👷", label: "Org Sandboxes" },
      { slug: "coding-models", icon: "🧠", label: "Coding Models" },
    ],
  },
];

/** Filter items by a case-insensitive label substring; drop groups left empty. */
export function filterGroups(groups: NavGroup[], query: string): NavGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q)) }))
    .filter((g) => g.items.length > 0);
}

/** Build the route for an item given its group scope and the active ids. */
export function navHref(
  group: NavGroup,
  item: NavItem,
  workspaceId: string | null,
  orgId: string | null,
): string {
  return group.scope === "org"
    ? `/orgs/${orgId}/${item.slug}`
    : `/workspaces/${workspaceId}/${item.slug}`;
}

/** Avatar initials: first+last for multi-word, first two letters otherwise. */
export function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w @journeyman/web -- nav-config`
Expected: PASS — all assertions green.

---

## Task 2: ProfileMenu component

**Files:**
- Create: `packages/web/src/components/ProfileMenu.tsx`

- [ ] **Step 1: Write the implementation**

Create `packages/web/src/components/ProfileMenu.tsx`. This extracts the profile block from the bottom of the old `Sidebar` into a header ghost button. It uses `initials` from `nav-config`.

```tsx
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../AuthContext.tsx";
import { initials } from "./nav-config.ts";

const ghost: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 8px",
  background: "none",
  border: "none",
  borderRadius: 7,
  cursor: "pointer",
  color: "rgb(var(--color-text) / 1)",
};

export function ProfileMenu() {
  const { user, org, role, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const label = user?.displayName?.trim() || user?.username || "?";
  const subtitle = [org?.name ?? org?.slug, role].filter(Boolean).join(" • ");

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={label}
        style={ghost}
        className="hover:bg-slate-800"
      >
        <div
          style={{
            width: 28,
            height: 28,
            background: "rgb(var(--color-accent) / 0.27)",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgb(var(--color-accent) / 1)",
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initials(label)}
        </div>
        <span style={{ fontSize: 10, color: "rgb(var(--color-text-subtle) / 1)" }}>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 6,
            width: 220,
            background: "rgb(var(--color-bg) / 1)",
            border: "1px solid rgb(var(--color-border) / 1)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            zIndex: 50,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "10px 12px", borderBottom: "1px solid rgb(var(--color-border) / 1)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "rgb(var(--color-text) / 1)" }}>{label}</div>
            {user?.username && user?.displayName && (
              <div style={{ fontSize: 11, color: "rgb(var(--color-border-strong) / 1)", marginTop: 2 }}>
                @{user.username}
              </div>
            )}
            {subtitle && (
              <div style={{ fontSize: 11, color: "rgb(var(--color-border) / 1)", marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
          <Link
            to="/me/password"
            role="menuitem"
            onClick={() => setOpen(false)}
            style={{ display: "block", padding: "8px 12px", fontSize: 13, color: "rgb(var(--color-text) / 1)", textDecoration: "none" }}
            className="hover:bg-slate-800"
          >
            Change password
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); void logout(); }}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "8px 12px",
              fontSize: 13,
              color: "rgb(var(--color-danger) / 1)",
              background: "none",
              border: "none",
              borderTop: "1px solid rgb(var(--color-border) / 1)",
              cursor: "pointer",
            }}
            className="hover:bg-danger/10"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Confirm `useAuth` exposes the fields used**

Run: `grep -n "displayName\|logout\|isPlatformAdmin\|activeOrgId\|role" packages/web/src/AuthContext.tsx`
Expected: `user`, `org`, `role`, `logout` are present on the auth context (same fields the old `Sidebar` consumed). If `role` is not directly destructurable, read the file and adjust the destructure to match its actual shape.

---

## Task 3: WorkspaceSwitcher — header variant

**Files:**
- Modify: `packages/web/src/components/WorkspaceSwitcher.tsx`

- [ ] **Step 1: Replace the file with the header-styled variant**

The switcher is now used only in the header. Drop the `expanded` prop entirely and render a borderless ghost button whose dropdown opens downward, right-aligned. Replace the full contents of `packages/web/src/components/WorkspaceSwitcher.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspace } from "../WorkspaceContext.tsx";

function wsInitial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspace, activeWorkspaceId, setActiveWorkspaceId } = useWorkspace();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (workspaces.length === 0) return null;

  const label = activeWorkspace?.name ?? "Select workspace";
  const initial = wsInitial(activeWorkspace?.name ?? "?");
  const isStatic = workspaces.length <= 1;

  function select(id: string) {
    setActiveWorkspaceId(id);
    setOpen(false);
    navigate(`/workspaces/${id}/workflows`);
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        disabled={isStatic}
        onClick={() => !isStatic && setOpen((o) => !o)}
        title={label}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 8px",
          background: "none",
          border: "none",
          borderRadius: 7,
          cursor: isStatic ? "default" : "pointer",
          color: "rgb(var(--color-text) / 1)",
          fontSize: 13,
          maxWidth: 220,
        }}
        className={isStatic ? undefined : "hover:bg-slate-800"}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: "rgb(var(--color-accent) / 0.27)",
            color: "rgb(var(--color-accent) / 1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initial}
        </div>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        {!isStatic && <span style={{ fontSize: 10, color: "rgb(var(--color-text-subtle) / 1)" }}>▾</span>}
      </button>

      {open && !isStatic && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            width: 220,
            background: "rgb(var(--color-bg) / 1)",
            border: "1px solid rgb(var(--color-border) / 1)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            zIndex: 60,
            overflow: "hidden",
          }}
        >
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              role="menuitem"
              onClick={() => select(w.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                fontSize: 13,
                background: w.id === activeWorkspaceId ? "rgb(var(--accent) / 1)" : "none",
                color: w.id === activeWorkspaceId ? "rgb(var(--accent-foreground) / 1)" : "rgb(var(--color-text) / 1)",
                border: "none",
                cursor: "pointer",
              }}
              className="hover:bg-slate-800"
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 5,
                  background: "rgb(var(--color-accent) / 0.27)",
                  color: "rgb(var(--color-accent) / 1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {wsInitial(w.name)}
              </div>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

Note: the old call site (`<WorkspaceSwitcher expanded={expanded} />` inside `Sidebar`) is removed in Task 5, so the dropped `expanded` prop leaves no dangling callers.

---

## Task 4: Header component

**Files:**
- Create: `packages/web/src/components/Header.tsx`

- [ ] **Step 1: Write the implementation**

Create `packages/web/src/components/Header.tsx`. The logo (relocated from the sidebar), then a right-aligned cluster of workspace switcher, theme toggle, and profile.

```tsx
import { Link } from "react-router-dom";
import { ThemeToggle } from "@journeyman/theme";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher.tsx";
import { ProfileMenu } from "./ProfileMenu.tsx";
import { Logo } from "./Logo.tsx";

export function Header() {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        height: 48,
        flexShrink: 0,
        padding: "0 14px",
        background: "rgb(var(--color-surface) / 1)",
        borderBottom: "1px solid rgb(var(--color-border) / 1)",
        zIndex: 30,
      }}
    >
      <Link to="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
        <Logo height={28} />
      </Link>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <WorkspaceSwitcher />
        <ThemeToggle />
        <ProfileMenu />
      </div>
    </header>
  );
}
```

---

## Task 5: Rewrite the Sidebar

**Files:**
- Rewrite: `packages/web/src/components/Sidebar.tsx`

- [ ] **Step 1: Replace the full file**

Replace the entire contents of `packages/web/src/components/Sidebar.tsx`. It now renders navigation only: a search box with ⌘K focus, collapsible groups from `nav-config`, and a collapse-to-rail toggle. Logo, pin, workspace switcher, profile, and theme toggle are gone (now in the header).

```tsx
import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../AuthContext.tsx";
import { useWorkspace } from "../WorkspaceContext.tsx";
import { NAV_GROUPS, filterGroups, navHref, type NavGroup } from "./nav-config.ts";

function usePersistentBool(key: string, initial: boolean) {
  const [val, setVal] = useState(() => {
    const s = localStorage.getItem(key);
    return s === null ? initial : s === "true";
  });
  useEffect(() => {
    localStorage.setItem(key, String(val));
  }, [key, val]);
  return [val, setVal] as const;
}

function navStyle(collapsed: boolean) {
  return ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: collapsed ? "7px 0" : "7px 12px",
    justifyContent: collapsed ? "center" : "flex-start",
    borderRadius: 6,
    margin: collapsed ? "1px 8px" : "1px 6px",
    textDecoration: "none",
    color: isActive ? "rgb(var(--accent-foreground) / 1)" : "rgb(var(--color-text-subtle) / 1)",
    background: isActive ? "rgb(var(--accent) / 1)" : "transparent",
    fontWeight: isActive ? 600 : 400,
    fontSize: 13,
    transition: "color 0.15s, background 0.15s",
  });
}

function NavGroupSection({
  group,
  collapsed,
  workspaceId,
  orgId,
}: {
  group: NavGroup;
  collapsed: boolean;
  workspaceId: string | null;
  orgId: string | null;
}) {
  const [folded, setFolded] = usePersistentBool(`sidebar-group-${group.id}`, false);

  return (
    <div style={{ marginBottom: 4 }}>
      {!collapsed && (
        <button
          type="button"
          onClick={() => setFolded((f) => !f)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            padding: "4px 14px 4px 12px",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "rgb(var(--color-text-subtle) / 1)",
            fontSize: 9,
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          <span>{group.label}</span>
          <span style={{ fontSize: 8 }}>{folded ? "▸" : "▾"}</span>
        </button>
      )}
      {collapsed && (
        <div style={{ borderTop: "1px solid rgb(var(--color-border) / 1)", margin: "6px 10px" }} />
      )}
      {(collapsed || !folded) &&
        group.items.map((item) => (
          <NavLink
            key={item.slug}
            to={navHref(group, item, workspaceId, orgId)}
            title={collapsed ? item.label : undefined}
            style={navStyle(collapsed)}
          >
            <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
            {!collapsed && <span style={{ whiteSpace: "nowrap", overflow: "hidden" }}>{item.label}</span>}
          </NavLink>
        ))}
    </div>
  );
}

export default function Sidebar() {
  const { role, isPlatformAdmin, activeOrgId } = useAuth();
  const { activeWorkspaceId, can } = useWorkspace();
  const isAdmin = role === "admin" || isPlatformAdmin;

  const [collapsed, setCollapsed] = usePersistentBool("sidebar-collapsed", false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K focuses search (expanding the rail first if needed).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCollapsed(false);
        // focus after the expand re-render
        setTimeout(() => searchRef.current?.focus(), 0);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setCollapsed]);

  // Gate groups/items by scope, role, and workspace permissions.
  const gated: NavGroup[] = NAV_GROUPS.flatMap((group) => {
    if (group.adminOnly && !isAdmin) return [];
    if (group.scope === "workspace" && !activeWorkspaceId) return [];
    if (group.scope === "org" && !activeOrgId) return [];
    const items = group.items.filter((i) => !i.perm || can(i.perm));
    return items.length ? [{ ...group, items }] : [];
  });

  const groups = filterGroups(gated, query);

  return (
    <div
      style={{
        width: collapsed ? 54 : 210,
        minWidth: collapsed ? 54 : 210,
        height: "100%",
        background: "rgb(var(--color-surface) / 1)",
        borderRight: "1px solid rgb(var(--color-border) / 1)",
        display: "flex",
        flexDirection: "column",
        padding: "10px 0",
        transition: "width 0.18s ease, min-width 0.18s ease",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* Search */}
      <div style={{ padding: collapsed ? "0 8px 8px" : "0 8px 10px", flexShrink: 0 }}>
        {collapsed ? (
          <button
            type="button"
            title="Search (⌘K)"
            onClick={() => {
              setCollapsed(false);
              setTimeout(() => searchRef.current?.focus(), 0);
            }}
            style={{
              width: "100%",
              padding: "7px 0",
              display: "flex",
              justifyContent: "center",
              background: "rgb(var(--color-bg) / 1)",
              border: "1px solid rgb(var(--color-border) / 1)",
              borderRadius: 7,
              cursor: "pointer",
              color: "rgb(var(--color-text-subtle) / 1)",
            }}
          >
            🔍
          </button>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "rgb(var(--color-bg) / 1)",
              border: "1px solid rgb(var(--color-border) / 1)",
              borderRadius: 7,
              padding: "5px 9px",
            }}
          >
            <span style={{ fontSize: 12, color: "rgb(var(--color-text-subtle) / 1)" }}>🔍</span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              style={{
                flex: 1,
                minWidth: 0,
                background: "none",
                border: "none",
                outline: "none",
                color: "rgb(var(--color-text) / 1)",
                fontSize: 12,
              }}
            />
            <span style={{ fontSize: 9, color: "rgb(var(--color-text-subtle) / 1)", border: "1px solid rgb(var(--color-border) / 1)", borderRadius: 3, padding: "1px 4px" }}>
              ⌘K
            </span>
          </div>
        )}
      </div>

      {/* Nav groups */}
      <nav style={{ flex: 1, overflowY: "auto" }}>
        {groups.map((group) => (
          <NavGroupSection
            key={group.id}
            group={group}
            collapsed={collapsed}
            workspaceId={activeWorkspaceId}
            orgId={activeOrgId}
          />
        ))}
        {!collapsed && groups.length === 0 && (
          <div style={{ padding: "8px 14px", fontSize: 12, color: "rgb(var(--color-text-subtle) / 1)" }}>
            No matches
          </div>
        )}
      </nav>

      {/* Collapse toggle */}
      <div style={{ padding: "8px 8px 0", borderTop: "1px solid rgb(var(--color-border) / 1)", flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            gap: 8,
            padding: collapsed ? "7px 0" : "7px 12px",
            background: "none",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            color: "rgb(var(--color-text-subtle) / 1)",
            fontSize: 13,
          }}
          className="hover:bg-slate-800"
        >
          <span style={{ fontSize: 14 }}>{collapsed ? "»" : "«"}</span>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Confirm `useWorkspace().can` accepts the permission string**

Run: `grep -n "can\b" packages/web/src/WorkspaceContext.tsx`
Expected: `can` is a function taking a permission string (the old sidebar called `can("members.manage")`). If its signature differs, adjust the `can(i.perm)` call to match.

---

## Task 6: Wire the Header into AppShell

**Files:**
- Modify: `packages/web/src/components/AppShell.tsx`

- [ ] **Step 1: Replace the file**

Replace the full contents of `packages/web/src/components/AppShell.tsx`:

```tsx
import { Outlet } from "react-router-dom";
import { Header } from "./Header.tsx";
import Sidebar from "./Sidebar.tsx";

export default function AppShell() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Header />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar />
        <main style={{ flex: 1, overflow: "hidden" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

---

## Task 7: Verification gate (typecheck + tests, no commit)

**Files:** none.

- [ ] **Step 1: Run the unit tests**

Run: `npm run test -w @journeyman/web -- nav-config`
Expected: PASS — the `nav-config` suite from Task 1 is green.

- [ ] **Step 2: Typecheck the web package**

Run: `npm run typecheck -w @journeyman/web`
Expected: exits 0 with no errors. In particular, no dangling references to the removed `WorkspaceSwitcher` `expanded` prop, the removed `Logo`/`LogoMark`/pin imports in `Sidebar`, or the moved profile/theme code.

- [ ] **Step 3: (Optional) Visual check in the dev preview**

If verifying in the browser: start the dev server, confirm the header shows the logo (left) and workspace switcher + theme toggle + profile (right); confirm the sidebar shows grouped nav, that group headers fold/persist, that the collapse button toggles the rail and persists across reload, and that ⌘K focuses search and filtering hides non-matching groups.

- [ ] **Step 4: Leave changes uncommitted**

Per the working constraints, do **not** `git commit`. Leave all changes in the working tree on `master` for review.

---

## Self-Review Notes

- **Spec coverage:** AppShell vertical column (Task 6); Header with logo + ghost-button cluster (Task 4); WorkspaceSwitcher header variant (Task 3); ProfileMenu extraction (Task 2); theme toggle relocated to header (Task 4); sidebar search + ⌘K, collapsible groups, collapse-to-rail with persisted state (Tasks 1 & 5); regrouping into Workspace / Integrations / Organization with the same gating conditions (Tasks 1 & 5); non-goals (command palette, breadcrumbs, mobile, backend) untouched.
- **Type consistency:** `NAV_GROUPS`, `NavGroup`, `filterGroups`, `navHref`, `initials` are defined in Task 1 and consumed unchanged in Tasks 2 and 5. `WorkspaceSwitcher` is called with no props in Task 4, matching its prop-free signature from Task 3.
- **Permissions:** workspace "Members" stays behind `can("members.manage")`; Organization group stays behind `isAdmin && activeOrgId`; workspace-scoped groups require `activeWorkspaceId` — same conditions as the original sidebar, just relocated into the gating loop in Task 5.
