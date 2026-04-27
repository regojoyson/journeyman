import type { FlowNode } from "@journeyman/core";
import type { PhaseCatalog } from "../types.ts";

export interface ConfigTabProps {
  node: FlowNode;
  catalog: PhaseCatalog;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

export function ConfigTab({ node, catalog, onChange, readOnly }: ConfigTabProps) {
  const entry = catalog.find(e => e.phaseType === node.phaseType);
  return (
    <div>
      <div className="je-props__field">
        <label>Phase type</label>
        <select
          value={node.phaseType ?? ""}
          disabled={readOnly}
          onChange={e => onChange({ ...node, phaseType: e.target.value })}
        >
          {catalog.map(c => <option key={c.phaseType} value={c.phaseType}>{c.label}</option>)}
        </select>
      </div>
      <div className="je-props__field">
        <label>Display name</label>
        <input
          type="text"
          value={node.displayName ?? ""}
          disabled={readOnly}
          onChange={e => onChange({ ...node, displayName: e.target.value })}
        />
      </div>
      <div className="je-props__field">
        <label>Config (JSON)</label>
        <textarea
          value={JSON.stringify(node.config ?? {}, null, 2)}
          disabled={readOnly}
          onChange={e => {
            try {
              onChange({ ...node, config: JSON.parse(e.target.value || "{}") });
            } catch {
              // leave config as-is until valid JSON
            }
          }}
        />
      </div>
      {entry?.description && (
        <div style={{ fontSize: 11, color: "#888", marginTop: 8 }}>{entry.description}</div>
      )}
    </div>
  );
}
