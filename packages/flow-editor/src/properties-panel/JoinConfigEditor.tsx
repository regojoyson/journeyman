import type { WorkflowGraph, WorkflowNode, JoinMode } from "@journeyman/core";

interface Props {
  flow: WorkflowGraph;
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

const MODE_OPTIONS: Array<{ value: JoinMode; label: string; desc: string }> = [
  { value: "fail-fast", label: "Fail fast", desc: "First branch error cancels the others and fails the workflow." },
  { value: "wait-all", label: "Wait for all", desc: "Let every branch finish. Workflow fails only if all branches failed." },
  { value: "wait-all-strict", label: "Wait for all (strict)", desc: "Let every branch finish. Workflow fails if any branch failed." },
  { value: "first-wins", label: "First wins", desc: "First branch to succeed wins; others are cancelled. v1: branches must contain only pause nodes (human-task, webhook-wait, timer)." },
];

export function JoinConfigEditor({ flow, node, onChange, readOnly }: Props) {
  const cfg = (node.config ?? {}) as { mode?: JoinMode; description?: string };
  const mode: JoinMode = cfg.mode ?? "fail-fast";
  const incomingBranches = flow.edges.filter(e => e.target === node.id).length;

  const update = (patch: Partial<typeof cfg>) => onChange({ ...node, config: { ...cfg, ...patch } });

  return (
    <div className="je-tab je-tab--config">
      <div className="je-field">
        <label className="je-field__label">Mode</label>
        <select
          value={mode}
          disabled={readOnly}
          onChange={e => update({ mode: e.target.value as JoinMode })}
        >
          {MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <p className="je-hint">{MODE_OPTIONS.find(o => o.value === mode)?.desc}</p>
      </div>
      {mode === "first-wins" && (
        <div className="je-field je-hint--warn">
          <strong>v1 restriction:</strong> first-wins branches may contain only pause nodes (human-task, webhook-wait, timer).
          Step nodes are not allowed and will be flagged in validation.
        </div>
      )}
      <div className="je-field">
        <label className="je-field__label">Description</label>
        <textarea
          rows={2}
          value={cfg.description ?? ""}
          disabled={readOnly}
          placeholder="What this join is waiting for."
          onChange={e => update({ description: e.target.value || undefined })}
        />
      </div>
      <div className="je-field">
        <label className="je-field__label">Incoming branches</label>
        <p className="je-hint">{incomingBranches} incoming branch{incomingBranches === 1 ? "" : "es"}.</p>
      </div>
      <div className="je-field">
        <label className="je-field__label">Output shape</label>
        <pre className="je-code-block">{outputShapeFor(mode)}</pre>
      </div>
    </div>
  );
}

function outputShapeFor(mode: JoinMode): string {
  if (mode === "fail-fast") return "// no Join-level output; reference branch nodes by id, e.g. stepA.field";
  if (mode === "first-wins") return JSON.stringify({ winner: "<branchHeadNodeId>", output: "<winning branch's last node output>" }, null, 2);
  return JSON.stringify({ results: { "<branchHeadNodeId>": { status: "success | error | cancelled", output: "<...>" } } }, null, 2);
}
