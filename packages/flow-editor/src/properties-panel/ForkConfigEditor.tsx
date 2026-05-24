import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";

interface Props {
  flow: WorkflowGraph;
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

export function ForkConfigEditor({ flow, node, onChange, readOnly }: Props) {
  const cfg = (node.config ?? {}) as { description?: string };
  const branchCount = flow.edges.filter(e => e.source === node.id).length;

  return (
    <div className="je-tab je-tab--config">
      <div className="je-field">
        <label className="je-field__label">Description</label>
        <textarea
          rows={2}
          value={cfg.description ?? ""}
          disabled={readOnly}
          placeholder="What this fork does, for future readers."
          onChange={e => onChange({ ...node, config: { ...cfg, description: e.target.value || undefined } })}
        />
      </div>
      <div className="je-field">
        <label className="je-field__label">Branches</label>
        <p className="je-hint">{branchCount} outgoing branch{branchCount === 1 ? "" : "es"}. Each runs in parallel until reaching the paired Join.</p>
      </div>
    </div>
  );
}
