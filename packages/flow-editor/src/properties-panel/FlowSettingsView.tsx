import type { WorkflowNode, RetryPolicy, WorkflowInputDef } from "@journeyman/core";
import { getStartWorkflowInputs } from "@journeyman/core";
import { RunInputsEditor } from "./RunInputsEditor.tsx";

export interface FlowSettingsViewProps {
  startNode: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

function getFlowRetry(node: WorkflowNode): RetryPolicy {
  const cfg = (node.config ?? {}) as { flowRetry?: RetryPolicy };
  return cfg.flowRetry ?? {};
}
function setFlowRetry(node: WorkflowNode, p: RetryPolicy): WorkflowNode {
  return { ...node, config: { ...(node.config ?? {}), flowRetry: p } };
}
function getCycleVisits(node: WorkflowNode): number {
  const cfg = (node.config ?? {}) as { maxCycleVisits?: number };
  return cfg.maxCycleVisits ?? 100;
}
function setCycleVisits(node: WorkflowNode, n: number): WorkflowNode {
  return { ...node, config: { ...(node.config ?? {}), maxCycleVisits: n } };
}
function getRunInputs(node: WorkflowNode): WorkflowInputDef[] {
  return getStartWorkflowInputs(node.config);
}
function setRunInputs(node: WorkflowNode, inputs: WorkflowInputDef[]): WorkflowNode {
  return { ...node, config: { ...(node.config ?? {}), workflowInputs: inputs } };
}

export function FlowSettingsView({ startNode, onChange, readOnly }: FlowSettingsViewProps) {
  const fr = getFlowRetry(startNode);
  const visits = getCycleVisits(startNode);

  return (
    <div>
      <div className="je-props__title">Flow settings</div>
      <div style={{ fontSize: 11, color: "rgb(var(--color-text-muted) / 1)", marginBottom: 12 }}>
        These apply to the whole flow, not just one node.
      </div>

      <div className="je-props__field">
        <label>Flow-level retry: max attempts</label>
        <input
          type="number" min={1}
          value={fr.maxAttempts ?? 1}
          disabled={readOnly}
          onChange={e => onChange(setFlowRetry(startNode, { ...fr, maxAttempts: Number(e.target.value) || 1 }))}
        />
      </div>
      <div className="je-props__field">
        <label>Flow-level retry: backoff seconds</label>
        <input
          type="number" min={0}
          value={fr.backoffSeconds ?? 30}
          disabled={readOnly}
          onChange={e => onChange(setFlowRetry(startNode, { ...fr, backoffSeconds: Number(e.target.value) || 0 }))}
        />
      </div>

      <div className="je-props__field">
        <label>Max visits per node (cycle guard)</label>
        <input
          type="number" min={1}
          value={visits}
          disabled={readOnly}
          onChange={e => onChange(setCycleVisits(startNode, Number(e.target.value) || 1))}
        />
      </div>

      <div className="je-props__field">
        <RunInputsEditor
          value={getRunInputs(startNode)}
          onChange={(inputs: WorkflowInputDef[]) => onChange(setRunInputs(startNode, inputs))}
        />
      </div>
    </div>
  );
}
