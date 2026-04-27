import type { ReactNode } from "react";

export type TabId = "config" | "mcp" | "credentials" | "retry" | "io";

export interface TabShellProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  children: ReactNode;
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "config",      label: "Config"      },
  { id: "mcp",         label: "MCP & Tools" },
  { id: "credentials", label: "Credentials" },
  { id: "retry",       label: "Retry"       },
  { id: "io",          label: "I/O"         },
];

export function TabsShell({ active, onChange, children }: TabShellProps) {
  return (
    <div>
      <div style={{ display: "flex", gap: 4, fontSize: 11, marginBottom: 10, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <div
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              padding: "6px 8px",
              borderBottom: t.id === active ? "2px solid #4a9eff" : "2px solid transparent",
              color: t.id === active ? "#4a9eff" : "#aaa",
              fontWeight: t.id === active ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {t.label}
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}
