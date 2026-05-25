import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { ThemeToggle } from "@journeyman/theme";
import { useAuth } from "../AuthContext.tsx";
import { Logo, LogoMark } from "./Logo.tsx";

const NAV_ITEMS = [
  { to: "/workflows",          icon: "⚡", label: "Workflows"          },
  { to: "/workflow-instances", icon: "▶",  label: "Workflow Instances" },
  { to: "/me/secrets",  icon: "🔑", label: "My Secrets" },
  { to: "/me/mcps",     icon: "🔌", label: "My MCPs"    },
  { to: "/me/skills",   icon: "🎓", label: "My Skills"  },
  { to: "/me/custom-steps", icon: "🧩", label: "My Custom Steps" },
  { to: "/me/webhooks", icon: "📡", label: "My Webhooks" },
];

const ADMIN_ITEMS = [
  { to: "/admin/users",   icon: "👥", label: "Users"       },
  { to: "/admin/secrets", icon: "🔐", label: "Org Secrets" },
  { to: "/admin/mcps",    icon: "🔌", label: "Org MCPs"    },
  { to: "/admin/skills",  icon: "📦", label: "Org Skills"  },
  { to: "/admin/custom-steps", icon: "🧩", label: "Org Custom Steps" },
  { to: "/admin/webhooks", icon: "📡", label: "Org Webhooks" },
  { to: "/admin/coding-models", icon: "🧠", label: "Coding Models" },
  { to: "/admin/workflows", icon: "📋", label: "Admin Workflows" },
];

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

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
    color: isActive ? "#4a9eff" : "#777",
    background: isActive ? "#4a9eff22" : "transparent",
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
          style={{
            color: "#e2e8f0",
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
              { to: "/me/skills",   label: "My Skills"       },
              { to: "/me/custom-steps", label: "My Custom Steps" },
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
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
