import { useEffect, useState } from "react";
import type { FlowNode } from "@journeyman/core";

interface VisibleMcp {
  id: string;
  name: string;
  description: string | null;
  scope: "user" | "org";
  enabled: boolean;
}

export interface McpToolsTabProps {
  node: FlowNode;
  orgId: string;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

function getSelectedIds(node: FlowNode): string[] {
  const cfg = (node.config ?? {}) as { mcpInstanceIds?: unknown };
  return Array.isArray(cfg.mcpInstanceIds)
    ? cfg.mcpInstanceIds.filter((x): x is string => typeof x === "string")
    : [];
}

function setSelectedIds(node: FlowNode, ids: string[]): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), mcpInstanceIds: ids } };
}

export function McpToolsTab({ node, orgId, onChange, readOnly }: McpToolsTabProps) {
  const [available, setAvailable] = useState<VisibleMcp[]>([]);
  const [loading, setLoading] = useState(true);
  const selected = getSelectedIds(node);
  const enabledIds = new Set(selected);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/orgs/${orgId}/mcp-instances/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleMcp[]) => {
        if (!alive) return;
        const sorted = [...rows]
          .filter((m) => m.enabled)
          .sort((a, b) =>
            a.scope === b.scope
              ? a.name.localeCompare(b.name)
              : a.scope === "org" ? -1 : 1
          );
        setAvailable(sorted);
      })
      .catch(() => { if (alive) setAvailable([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [orgId]);

  const toggle = (id: string) => {
    if (readOnly) return;
    const next = enabledIds.has(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    onChange(setSelectedIds(node, next));
  };

  return (
    <div>
      <div className="je-props__field">
        <label>MCPs</label>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
          MCPs to attach when this phase runs. Manage your MCPs at{" "}
          <a href="/me/mcps" target="_blank" rel="noreferrer" style={{ color: "#4a9eff" }}>/me/mcps</a>{" "}
          or{" "}
          <a href="/admin/mcps" target="_blank" rel="noreferrer" style={{ color: "#4a9eff" }}>/admin/mcps</a>.
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: "#888" }}>Loading…</div>
        ) : available.length === 0 ? (
          <div style={{ fontSize: 12, color: "#888" }}>
            No MCPs registered. Add some at{" "}
            <a href="/me/mcps" target="_blank" rel="noreferrer" style={{ color: "#4a9eff" }}>/me/mcps</a>.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {available.map((m) => {
              const checked = enabledIds.has(m.id);
              return (
                <label
                  key={m.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    background: "#1f1f2c",
                    border: `1px solid ${checked ? "#4a9eff" : "#2a2a3a"}`,
                    borderRadius: 6,
                    padding: "6px 8px",
                    cursor: readOnly ? "not-allowed" : "pointer",
                    opacity: readOnly ? 0.6 : 1,
                  }}
                  title={m.description ?? ""}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={readOnly}
                    onChange={() => toggle(m.id)}
                  />
                  <span style={{ flex: 1 }}>{m.name}</span>
                  <span style={{ fontSize: 10, color: "#888" }}>{m.scope}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
