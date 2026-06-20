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
