import { useEffect, useState } from "react";
import type { WorkflowNode, CanonicalTool, CustomAiStep } from "@journeyman/core";
import { CANONICAL_TOOLS } from "@journeyman/core";

interface VisibleMcp {
  id: string;
  name: string;
  description: string | null;
  scope: "user" | "org";
  enabled: boolean;
}

export interface McpToolsTabProps {
  node: WorkflowNode;
  orgId: string;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

function getSelectedIds(node: WorkflowNode): string[] {
  const cfg = (node.config ?? {}) as { mcpInstanceIds?: unknown };
  return Array.isArray(cfg.mcpInstanceIds)
    ? cfg.mcpInstanceIds.filter((x): x is string => typeof x === "string")
    : [];
}

function setSelectedIds(node: WorkflowNode, ids: string[]): WorkflowNode {
  return { ...node, config: { ...(node.config ?? {}), mcpInstanceIds: ids } };
}

function getCustomStepId(node: WorkflowNode): string | undefined {
  const cfg = (node.config ?? {}) as { customStepId?: unknown };
  return typeof cfg.customStepId === "string" ? cfg.customStepId : undefined;
}

function getToolsOverride(node: WorkflowNode): CanonicalTool[] | undefined {
  const cfg = (node.config ?? {}) as { tools?: unknown };
  return Array.isArray(cfg.tools) ? cfg.tools as CanonicalTool[] : undefined;
}

function setToolsOverride(node: WorkflowNode, tools: CanonicalTool[] | undefined): WorkflowNode {
  if (tools === undefined) {
    const { tools: _t, ...rest } = (node.config ?? {}) as { tools?: unknown };
    return { ...node, config: rest };
  }
  return { ...node, config: { ...(node.config ?? {}), tools } };
}

export function McpToolsTab({ node, orgId, onChange, readOnly }: McpToolsTabProps) {
  const [available, setAvailable] = useState<VisibleMcp[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<CustomAiStep | null>(null);
  const selected = getSelectedIds(node);
  const enabledIds = new Set(selected);
  const customStepId = getCustomStepId(node);

  useEffect(() => {
    if (!customStepId || !orgId) { setStep(null); return; }
    let alive = true;
    fetch(`/api/orgs/${orgId}/users/me/custom-steps/${customStepId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .catch(() =>
        fetch(`/api/orgs/${orgId}/custom-steps/${customStepId}`, { credentials: "include" })
          .then((r) => (r.ok ? r.json() : Promise.reject(r))),
      )
      .then((p) => { if (alive) setStep(p as CustomAiStep); })
      .catch(() => { if (alive) setStep(null); });
    return () => { alive = false; };
  }, [orgId, customStepId]);

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

  const toolsOverride = getToolsOverride(node);
  const effectiveTools: CanonicalTool[] = toolsOverride ?? step?.defaultTools ?? [];
  const overriding = toolsOverride !== undefined;

  const toggleTool = (t: CanonicalTool) => {
    if (readOnly) return;
    const cur = new Set(effectiveTools);
    if (cur.has(t)) cur.delete(t); else cur.add(t);
    onChange(setToolsOverride(node, [...cur]));
  };

  return (
    <div>
      <div className="je-props__field">
        <label>MCPs</label>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
          MCPs to attach when this step runs. Manage your MCPs at{" "}
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

      {customStepId && (
        <div className="je-props__field">
          <label>
            Tools{" "}
            {overriding ? (
              <span style={{ fontSize: 11, color: "#fdcb6e" }}>(overriding definition)</span>
            ) : (
              <span style={{ fontSize: 11, color: "#888" }}>(definition default)</span>
            )}
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {CANONICAL_TOOLS.map((t) => {
              const active = effectiveTools.includes(t);
              return (
                <label
                  key={t}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    padding: "2px 6px",
                    border: "1px solid #444",
                    borderRadius: 4,
                    background: active ? "#4a9eff22" : "transparent",
                    cursor: readOnly ? "default" : "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={active}
                    onChange={() => toggleTool(t)}
                  />
                  {t}
                </label>
              );
            })}
          </div>
          {overriding && !readOnly && (
            <button
              type="button"
              onClick={() => onChange(setToolsOverride(node, undefined))}
              style={{ marginTop: 6, fontSize: 11 }}
            >
              Reset to definition default
            </button>
          )}
        </div>
      )}
    </div>
  );
}
