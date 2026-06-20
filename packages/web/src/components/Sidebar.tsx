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

  // Cmd/Ctrl+K focuses search (expanding the rail first if needed).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCollapsed(false);
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
            title="Search (Cmd+K)"
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
            {"🔍"}
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
            <span style={{ fontSize: 12, color: "rgb(var(--color-text-subtle) / 1)" }}>{"🔍"}</span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
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
              {"⌘K"}
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
