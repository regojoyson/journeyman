import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspace } from "../WorkspaceContext.tsx";

function wsInitial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export function WorkspaceSwitcher({ expanded }: { expanded: boolean }) {
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

  function select(id: string) {
    setActiveWorkspaceId(id);
    setOpen(false);
    navigate(`/workspaces/${id}/workflows`);
  }

  // Single workspace: static, no dropdown.
  const isStatic = workspaces.length <= 1;

  return (
    <div ref={ref} style={{ position: "relative", padding: expanded ? "0 8px 8px" : "0 0 8px", flexShrink: 0 }}>
      <button
        type="button"
        disabled={isStatic}
        onClick={() => !isStatic && setOpen((o) => !o)}
        title={label}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: expanded ? "6px 8px" : "6px 0",
          justifyContent: expanded ? "flex-start" : "center",
          background: "rgb(var(--color-bg) / 1)",
          border: "1px solid rgb(var(--color-border) / 1)",
          borderRadius: 6,
          cursor: isStatic ? "default" : "pointer",
          color: "rgb(var(--color-text) / 1)",
          fontSize: 13,
          minWidth: 0,
        }}
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
        {expanded && (
          <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {label}
          </span>
        )}
        {expanded && !isStatic && <span style={{ fontSize: 10, color: "rgb(var(--color-text-subtle) / 1)" }}>▾</span>}
      </button>

      {open && !isStatic && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "100%",
            left: expanded ? 8 : "50%",
            transform: expanded ? "none" : "translateX(-50%)",
            marginTop: 4,
            width: 200,
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
