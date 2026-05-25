// packages/flow-editor/src/properties-panel/trigger-manual-panel.tsx
import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";

export interface TriggerManualPanelProps {
  node: WorkflowNode;
  graph: WorkflowGraph;
}

export function TriggerManualPanel({ graph }: TriggerManualPanelProps): JSX.Element {
  const inputs = graph.inputDefs ?? [];
  return (
    <div className="jm-properties-panel-section">
      <h3>Manual trigger</h3>
      <p>Fires when a user clicks Run, or via <code>POST /workflows/:id/workflow-instances</code>.</p>
      <h4>Form preview</h4>
      {inputs.length === 0 ? (
        <p>This workflow has no inputs. The Run form will be empty.</p>
      ) : (
        <ul>
          {inputs.map((inp) => (
            <li key={inp.name}>
              <strong>{inp.name}</strong> <em>({inp.type})</em>
              {inp.required ? " — required" : ""}
              {inp.description ? ` — ${inp.description}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
