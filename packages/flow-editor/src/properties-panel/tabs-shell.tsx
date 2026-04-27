import type { ReactNode } from "react";

export type TabId = "config" | "mcp" | "credentials" | "retry" | "io";

export interface TabShellProps {
  active: TabId;
  children: ReactNode;
}

const TABS: Array<{ id: TabId; label: string; enabled: boolean }> = [
  { id: "config",      label: "Config",      enabled: true  },
  { id: "mcp",         label: "MCP",         enabled: false },
  { id: "credentials", label: "Credentials", enabled: false },
  { id: "retry",       label: "Retry",       enabled: false },
  { id: "io",          label: "I/O",         enabled: false },
];

export function TabsShell({ active, children }: TabShellProps) {
  return (
    <div>
      <div style={{ display: "flex", gap: 4, fontSize: 11, marginBottom: 10 }}>
        {TABS.map(t => (
          <div
            key={t.id}
            style={{
              padding: "6px 8px",
              borderBottom: t.id === active ? "2px solid #4a9eff" : "2px solid transparent",
              color: !t.enabled ? "#555" : (t.id === active ? "#4a9eff" : "#aaa"),
              fontWeight: t.id === active ? 600 : 400,
              cursor: t.enabled ? "pointer" : "not-allowed",
            }}
            title={!t.enabled ? "Coming in a later phase" : ""}
          >
            {t.label}
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}
