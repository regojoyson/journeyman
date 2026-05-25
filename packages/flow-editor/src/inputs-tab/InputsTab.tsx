// packages/flow-editor/src/inputs-tab/InputsTab.tsx
import type { WorkflowGraph, WorkflowInputDef } from "@journeyman/core";

export interface InputsTabProps {
  graph: WorkflowGraph;
  onPatchInputs: (next: WorkflowInputDef[]) => void;
}

export function InputsTab({ graph, onPatchInputs }: InputsTabProps): JSX.Element {
  const inputs = graph.inputDefs ?? [];

  function update(idx: number, patch: Partial<WorkflowInputDef>): void {
    const next = inputs.map((inp, i) => (i === idx ? { ...inp, ...patch } : inp));
    onPatchInputs(next);
  }
  function add(): void {
    onPatchInputs([
      ...inputs,
      { name: `input_${inputs.length + 1}`, type: "string", required: false },
    ]);
  }
  function remove(idx: number): void {
    onPatchInputs(inputs.filter((_, i) => i !== idx));
  }

  return (
    <div className="jm-inputs-tab">
      <h2>Workflow inputs</h2>
      <p>All triggers map their source data onto these inputs.</p>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Required</th>
            <th>Description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {inputs.map((inp, idx) => (
            <tr key={idx}>
              <td>
                <input
                  value={inp.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                />
              </td>
              <td>
                <select
                  value={inp.type}
                  onChange={(e) => update(idx, { type: e.target.value as WorkflowInputDef["type"] })}
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="json">json</option>
                </select>
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={inp.required === true}
                  onChange={(e) => update(idx, { required: e.target.checked })}
                />
              </td>
              <td>
                <input
                  value={inp.description ?? ""}
                  onChange={(e) => update(idx, { description: e.target.value || undefined })}
                />
              </td>
              <td>
                <button type="button" onClick={() => remove(idx)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={add}>+ Add input</button>
    </div>
  );
}
