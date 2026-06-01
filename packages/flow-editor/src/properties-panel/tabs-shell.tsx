// packages/flow-editor/src/properties-panel/tabs-shell.tsx
import type { ReactNode } from "react";
import type { TabVisibility } from "../step-definition.ts";

export type TabId = "config" | "mcp" | "skills" | "requiredSecrets" | "retry" | "io" | "worker";

export interface TabsVisibility {
  config?: TabVisibility; // always shown effectively; declared for symmetry
  io: TabVisibility;
  requiredSecrets: TabVisibility;
  mcp: TabVisibility;
  skills: TabVisibility;
  retry: TabVisibility;
  /** Optional — defaults to "shown" when omitted by a step definition. */
  worker?: TabVisibility;
}

export interface TabRequiredFlags {
  io?: boolean;
  requiredSecrets?: boolean;
  mcp?: boolean;
  skills?: boolean;
  retry?: boolean;
  worker?: boolean;
}

export interface TabShellProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  visibility: TabsVisibility;
  /** Per-tab "data is empty" flags — when a tab is `required` AND its flag is true, decorate with •. */
  requiredEmpty?: TabRequiredFlags;
  children: ReactNode;
}

const ALL_TABS: Array<{ id: TabId; label: string }> = [
  { id: "config",          label: "Config"           },
  { id: "mcp",             label: "MCP & Tools"      },
  { id: "skills",          label: "Skills"           },
  { id: "requiredSecrets", label: "Required secrets" },
  { id: "retry",           label: "Retry"            },
  { id: "worker",          label: "Worker"           },
  { id: "io",              label: "I/O"              },
];

function visibilityOf(id: TabId, v: TabsVisibility): TabVisibility {
  if (id === "config") return "shown";
  if (id === "worker") return v.worker ?? "shown";
  return v[id];
}

export function TabsShell({ active, onChange, visibility, requiredEmpty, children }: TabShellProps) {
  const visible = ALL_TABS.filter(t => visibilityOf(t.id, visibility) !== "hidden");

  return (
    <div>
      <div style={{ display: "flex", gap: 4, fontSize: 11, marginBottom: 10, flexWrap: "wrap" }}>
        {visible.map(t => {
          const req = visibilityOf(t.id, visibility) === "required";
          const empty = req && t.id !== "config" && (requiredEmpty?.[t.id as Exclude<TabId, "config">] ?? false);
          return (
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
              {t.label}{empty ? " •" : ""}
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}
