import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../AuthContext.tsx";

const styles = {
  nav: {
    display: "flex", alignItems: "center", gap: 16,
    background: "#11111a", borderBottom: "1px solid #2a2a3a",
    padding: "10px 18px", fontSize: 13,
  } as React.CSSProperties,
  brand: { fontWeight: 700, color: "#4a9eff", marginRight: 12, textDecoration: "none" } as React.CSSProperties,
  link: { color: "#aaa", textDecoration: "none" } as React.CSSProperties,
  linkActive: { color: "#fff", fontWeight: 600 } as React.CSSProperties,
  body: { height: "calc(100vh - 41px)", overflow: "hidden" } as React.CSSProperties,
};

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function AppShell() {
  const { role, user, org, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const navStyle = ({ isActive }: { isActive: boolean }) =>
    ({ ...styles.link, ...(isActive ? styles.linkActive : {}) });

  const label = user?.displayName?.trim() || user?.username || "?";
  const subtitle = [org?.name ?? org?.slug, role].filter(Boolean).join(" • ");

  return (
    <div>
      <nav style={styles.nav}>
        <Link to="/" style={styles.brand}>◆ Journeyman</Link>
        <NavLink to="/flows" style={navStyle}>Flows</NavLink>
        <NavLink to="/runs" style={navStyle}>Runs</NavLink>
        <NavLink to="/me/secrets" style={navStyle}>My Secrets</NavLink>
        {role === "admin" && <NavLink to="/admin/users" style={navStyle}>Users</NavLink>}
        {role === "admin" && <NavLink to="/admin/secrets" style={navStyle}>Org Secrets</NavLink>}

        <div style={{ marginLeft: "auto" }} ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className={
              "flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800/60 " +
              "hover:border-slate-500 hover:bg-slate-800 px-2 py-1 text-slate-200 transition"
            }
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-300 text-[11px] font-semibold">
              {initials(label)}
            </span>
            <span className="text-sm font-medium">{label}</span>
            {role && (
              <span className="rounded-sm bg-slate-700/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                {role}
              </span>
            )}
            <svg width="10" height="10" viewBox="0 0 10 10" className={"text-slate-400 transition " + (open ? "rotate-180" : "")}>
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open && (
            <div
              role="menu"
              className={
                "absolute right-0 mt-2 w-60 rounded-lg border border-slate-700 bg-slate-900 " +
                "shadow-xl py-1 z-50"
              }
            >
              <div className="px-3 py-2 border-b border-slate-800">
                <div className="text-sm font-medium text-slate-100">{label}</div>
                {user?.username && user?.displayName && (
                  <div className="text-xs text-slate-400">@{user.username}</div>
                )}
                {subtitle && <div className="mt-1 text-xs text-slate-500">{subtitle}</div>}
              </div>
              <Link
                to="/me/secrets"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                My Secrets
              </Link>
              <Link
                to="/me/password"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Change password
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); void logout(); }}
                className="w-full text-left px-3 py-2 text-sm text-rose-300 hover:bg-rose-950/40 border-t border-slate-800"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </nav>
      <main style={styles.body}>
        <Outlet />
      </main>
    </div>
  );
}
