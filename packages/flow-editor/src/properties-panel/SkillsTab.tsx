import { useEffect, useState } from "react";
import type { WorkflowNode } from "@journeyman/core";
import { useWsId } from "../state/org-context.tsx";

interface VisibleSkill {
  id: string;
  name: string;
  scope: "user" | "org";
  installStatus: "pending" | "installing" | "ready" | "error";
  enabledSkillCount: number;
}

export interface SkillsTabProps {
  node: WorkflowNode;
  orgId: string;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

function getSelectedIds(node: WorkflowNode): string[] {
  const cfg = (node.config ?? {}) as { skillPackageIds?: unknown };
  return Array.isArray(cfg.skillPackageIds)
    ? cfg.skillPackageIds.filter((x): x is string => typeof x === "string")
    : [];
}

function setSelectedIds(node: WorkflowNode, ids: string[]): WorkflowNode {
  return { ...node, config: { ...(node.config ?? {}), skillPackageIds: ids } };
}

export function SkillsTab({ node, onChange, readOnly }: SkillsTabProps) {
  const wsId = useWsId();
  const [available, setAvailable] = useState<VisibleSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const selected = getSelectedIds(node);
  const enabledIds = new Set(selected);

  useEffect(() => {
    if (!wsId) { setAvailable([]); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    fetch(`/api/workspaces/${wsId}/skill-packages/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleSkill[]) => {
        if (!alive) return;
        const sorted = [...rows].sort((a, b) =>
          a.scope === b.scope
            ? a.name.localeCompare(b.name)
            : a.scope === "org" ? -1 : 1
        );
        setAvailable(sorted);
      })
      .catch(() => { if (alive) setAvailable([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [wsId]);

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
        <label>Skills</label>
        <div style={{ fontSize: 11, color: "rgb(var(--color-text-muted) / 1)", marginBottom: 8 }}>
          Skill packages to load when this step runs. Manage your skills on the{" "}
          <a href={`/workspaces/${wsId}/skills`} target="_blank" rel="noreferrer" style={{ color: "rgb(var(--color-info) / 1)" }}>Skills page</a>.
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: "rgb(var(--color-text-muted) / 1)" }}>Loading…</div>
        ) : available.length === 0 ? (
          <div style={{ fontSize: 12, color: "rgb(var(--color-text-muted) / 1)" }}>
            No ready skill packages. Add some on the{" "}
            <a href={`/workspaces/${wsId}/skills`} target="_blank" rel="noreferrer" style={{ color: "rgb(var(--color-info) / 1)" }}>Skills page</a>.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {available.map((s) => {
              const checked = enabledIds.has(s.id);
              return (
                <label
                  key={s.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    background: "rgb(var(--color-surface) / 1)",
                    border: `1px solid ${checked ? "rgb(var(--color-info) / 1)" : "rgb(var(--color-surface-raised) / 1)"}`,
                    borderRadius: 6,
                    padding: "6px 8px",
                    cursor: readOnly ? "not-allowed" : "pointer",
                    opacity: readOnly ? 0.6 : 1,
                  }}
                  title={`${s.enabledSkillCount} enabled skill${s.enabledSkillCount === 1 ? "" : "s"}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={readOnly}
                    onChange={() => toggle(s.id)}
                  />
                  <span style={{ flex: 1 }}>{s.name}</span>
                  <span style={{ fontSize: 10, color: "rgb(var(--color-text-muted) / 1)" }}>{s.scope}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
