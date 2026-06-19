import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { ThemeToggle } from "@journeyman/theme";
import { useAuth } from "../AuthContext.tsx";
import { useWorkspace } from "../WorkspaceContext.tsx";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher.tsx";
import { Logo, LogoMark } from "./Logo.tsx";

const WORKSPACE_ITEMS = [
  { slug: "workflows",          icon: "⚡", label: "Workflows"          },
  { slug: "workflow-instances", icon: "▶",  label: "Workflow Instances" },
  { slug: "secrets",       icon: "🔑", label: "Secrets" },
  { slug: "skills",        icon: "🎓", label: "Skills"  },
  { slug: "mcps",          icon: "🔌", label: "MCPs"    },
  { slug: "custom-steps",  icon: "🧩", label: "Custom Steps" },
  { slug: "agents",        icon: "🤖", label: "Agents" },
  { slug: "connections",   icon: "🔗", label: "Connections" },
  { slug: "webhooks",      icon: "📡", label: "Webhooks" },
];

const ORG_ITEMS = [
  { slug: "workspaces",    icon: "🗂", label: "Workspaces"   },
  { slug: "members",       icon: "👥", label: "Members"      },
  { slug: "secrets",       icon: "🔐", label: "Org Secrets"  },
  { slug: "sandboxes",     icon: "👷", label: "Org Sandboxes" },
  { slug: "coding-models", icon: "🧠", label: "Coding Models" },
];

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Sidebar() {
  const { role, user, org, isPlatformAdmin, activeOrgId, logout } = useAuth();
  const { activeWorkspaceId, can } = useWorkspace();
  const isAdmin = role === "admin" || isPlatformAdmin;
  const [pinned, setPinned] = useState(
    () => localStorage.getItem("sidebar-pinned") === "true"
  );
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const expanded = pinned || hovered;

  const label = user?.displayName?.trim() || user?.username || "?";
  const subtitle = [org?.name ?? org?.slug, role].filter(Boolean).join(" • ");

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

  const navStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: expanded ? "7px 14px" : "7px 0",
    justifyContent: expanded ? "flex-start" : "center",
    borderRadius: 6,
    textDecoration: "none",
    color: isActive ? "rgb(var(--accent-foreground) / 1)" : "rgb(var(--color-text-subtle) / 1)",
    background: isActive ? "rgb(var(--accent) / 1)" : "transparent",
    fontWeight: isActive ? 600 : 400,
    fontSize: 13,
    transition: "color 0.15s, background 0.15s",
  });

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: expanded ? 200 : 52,
        minWidth: expanded ? 200 : 52,
        height: "100vh",
        background: "rgb(var(--color-surface) / 1)",
        borderRight: "1px solid rgb(var(--color-border) / 1)",
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
          style={{
            color: "rgb(var(--color-text) / 1)",
            fontWeight: 700,
            textDecoration: "none",
            fontSize: 13,
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
          }}
        >
          {expanded ? <Logo height={40} /> : <LogoMark height={28} />}
        </Link>
        {expanded && (
          <button
            type="button"
            onClick={() => setPinned(p => !p)}
            title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
            style={{
              background: "rgb(var(--color-info) / 0.13)",
              border: "none",
              borderRadius: 4,
              width: 20,
              height: 20,
              cursor: "pointer",
              color: "rgb(var(--color-info) / 1)",
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

      {/* Workspace switcher */}
      <WorkspaceSwitcher expanded={expanded} />

      {/* Nav items */}
      <nav style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: expanded ? "0 6px" : "0 8px",
        flex: 1,
        overflowY: "auto",
      }}>
        {activeWorkspaceId && WORKSPACE_ITEMS.map(({ slug, icon, label: itemLabel }) => (
          <NavLink key={slug} to={`/workspaces/${activeWorkspaceId}/${slug}`} style={navStyle}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
            {expanded && (
              <span style={{ whiteSpace: "nowrap", overflow: "hidden" }}>{itemLabel}</span>
            )}
          </NavLink>
        ))}

        {activeWorkspaceId && can("members.manage") && (
          <NavLink to={`/workspaces/${activeWorkspaceId}/members`} style={navStyle}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>👤</span>
            {expanded && (
              <span style={{ whiteSpace: "nowrap", overflow: "hidden" }}>Members</span>
            )}
          </NavLink>
        )}

        {isAdmin && activeOrgId && (
          <>
            <div style={{ borderTop: "1px solid rgb(var(--color-border) / 1)", margin: "6px 0" }} />
            {expanded && (
              <div style={{
                padding: "2px 8px 4px",
                color: "rgb(var(--color-text-subtle) / 1)",
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}>
                Organization
              </div>
            )}
            {ORG_ITEMS.map(({ slug, icon, label: itemLabel }) => (
              <NavLink key={slug} to={`/orgs/${activeOrgId}/${slug}`} style={navStyle}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
                {expanded && (
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden" }}>{itemLabel}</span>
                )}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* User profile */}
      <div
        ref={menuRef}
        style={{
          padding: expanded ? "8px 8px 0" : "8px 0 0",
          borderTop: "1px solid rgb(var(--color-border) / 1)",
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
                <div style={{ fontSize: 11, color: "rgb(var(--color-border-strong) / 1)", marginTop: 2 }}>@{user.username}</div>
              )}
              {subtitle && (
                <div style={{ fontSize: 11, color: "rgb(var(--color-border) / 1)", marginTop: 2 }}>{subtitle}</div>
              )}
            </div>
            {[
              { to: "/me/password", label: "Change password" },
            ].map(({ to, label: itemLabel }) => (
              <Link
                key={to}
                to={to}
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                style={{ display: "block", padding: "8px 12px", fontSize: 13, color: "rgb(var(--color-text) / 1)", textDecoration: "none" }}
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

        <div
          style={{
            display: "flex",
            flexDirection: expanded ? "row" : "column-reverse",
            alignItems: "center",
            justifyContent: expanded ? "space-between" : "center",
            gap: expanded ? 8 : 6,
          }}
        >
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
            flex: expanded ? 1 : "0 0 auto",
            minWidth: 0,
            borderRadius: 6,
          }}
        >
          <div style={{
            width: 30,
            height: 30,
            background: "rgb(var(--color-accent) / 0.27)",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgb(var(--color-accent) / 1)",
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}>
            {initials(label)}
          </div>
          {expanded && (
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "rgb(var(--color-text) / 1)", whiteSpace: "nowrap" }}>{label}</div>
              {role && <div style={{ fontSize: 10, color: "rgb(var(--color-border-strong) / 1)" }}>{role}</div>}
            </div>
          )}
        </button>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
