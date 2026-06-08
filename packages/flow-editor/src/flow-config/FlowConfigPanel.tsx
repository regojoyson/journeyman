import type { WorkflowDefaults, WorkflowGraph } from "@journeyman/core";
import { X } from "lucide-react";
import { DefaultsRetrySection } from "./DefaultsRetrySection.tsx";
import { DefaultsExecutorSection } from "./DefaultsExecutorSection.tsx";
import { DefaultsModelSection } from "./DefaultsModelSection.tsx";
import { DefaultsSandboxSection } from "./DefaultsSandboxSection.tsx";

export interface FlowConfigPanelProps {
  flow: WorkflowGraph;
  onChange: (next: WorkflowGraph) => void;
  onClose: () => void;
  readOnly?: boolean;
}

export function FlowConfigPanel({ flow, onChange, onClose, readOnly }: FlowConfigPanelProps) {
  const defaults = flow.defaults ?? {};
  const updateDefaults = (next: WorkflowDefaults) =>
    onChange({ ...flow, defaults: Object.keys(next).length ? next : undefined });

  return (
    <aside className="je-editor__props" style={{ borderLeft: "1px solid #2a2a3a" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div className="je-props__title" style={{ margin: 0 }}>Flow Defaults</div>
        <button type="button" onClick={onClose}
          style={{ background: "none", border: "none", color: "#888", cursor: "pointer", padding: 4 }}>
          <X size={14} aria-hidden />
        </button>
      </div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 12 }}>
        Values set here are inherited by all step nodes. Each node can override individual fields.
      </div>

      <DefaultsExecutorSection defaults={defaults} onChange={updateDefaults} readOnly={readOnly} />
      <DefaultsModelSection    defaults={defaults} onChange={updateDefaults} readOnly={readOnly} />
      <DefaultsSandboxSection   defaults={defaults} onChange={updateDefaults} readOnly={readOnly} />
      <DefaultsRetrySection    defaults={defaults} onChange={updateDefaults} readOnly={readOnly} />
    </aside>
  );
}
