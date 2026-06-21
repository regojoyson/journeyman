// packages/flow-editor/src/inputs-tab/InputsTab.tsx
import type { JSX } from "react";
import type { WorkflowGraph, WorkflowInputDef, WorkflowAttributeDef } from "@journeyman/core";
import { AttributeValueField } from "./AttributeValueField.tsx";

export interface InputsTabProps {
  graph: WorkflowGraph;
  onPatchInputs: (next: WorkflowInputDef[]) => void;
  onPatchAttributes: (next: WorkflowAttributeDef[]) => void;
}

export function InputsTab({ graph, onPatchInputs, onPatchAttributes }: InputsTabProps): JSX.Element {
  const inputs = graph.inputDefs ?? [];
  const attributes = graph.attributeDefs ?? [];

  function updateInput(idx: number, patch: Partial<WorkflowInputDef>): void {
    onPatchInputs(inputs.map((inp, i) => (i === idx ? { ...inp, ...patch } : inp)));
  }
  function addInput(): void {
    onPatchInputs([...inputs, { name: `input_${inputs.length + 1}`, type: "string", required: false }]);
  }
  function removeInput(idx: number): void {
    onPatchInputs(inputs.filter((_, i) => i !== idx));
  }

  function updateAttr(idx: number, patch: Partial<WorkflowAttributeDef>): void {
    onPatchAttributes(attributes.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }
  function addAttr(): void {
    onPatchAttributes([...attributes, { name: `attribute_${attributes.length + 1}`, type: "string", value: "" }]);
  }
  function removeAttr(idx: number): void {
    onPatchAttributes(attributes.filter((_, i) => i !== idx));
  }

  // Name validation: non-empty + unique within attributes.
  function attrNameError(idx: number): string | null {
    const name = attributes[idx].name.trim();
    if (!name) return "Name required";
    const dup = attributes.some((a, i) => i !== idx && a.name.trim() === name);
    return dup ? "Duplicate name" : null;
  }

  return (
    <div className="jm-inputs-tab">
      <h2>Workflow inputs</h2>
      <p>All triggers map their source data onto these inputs.</p>
      <table className="jm-inputs-tab__table">
        <colgroup>
          <col className="jm-inputs-tab__col-name" />
          <col className="jm-inputs-tab__col-type" />
          <col className="jm-inputs-tab__col-required" />
          <col className="jm-inputs-tab__col-description" />
          <col className="jm-inputs-tab__col-actions" />
        </colgroup>
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
                <input type="text" value={inp.name} onChange={(e) => updateInput(idx, { name: e.target.value })} />
              </td>
              <td>
                <select value={inp.type} onChange={(e) => updateInput(idx, { type: e.target.value as WorkflowInputDef["type"] })}>
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="json-object">json object</option>
                  <option value="json-array">json array</option>
                </select>
              </td>
              <td className="jm-inputs-tab__cell-required">
                <input type="checkbox" checked={inp.required === true} onChange={(e) => updateInput(idx, { required: e.target.checked })} />
              </td>
              <td>
                <input type="text" value={inp.description ?? ""} onChange={(e) => updateInput(idx, { description: e.target.value || undefined })} />
              </td>
              <td>
                <button type="button" className="jm-inputs-tab__remove" onClick={() => removeInput(idx)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={addInput}>+ Add input</button>

      <h2>Default attributes</h2>
      <p>Constant values you can pick from any step's config, like inputs.</p>
      <table className="jm-inputs-tab__table">
        <colgroup>
          <col className="jm-inputs-tab__col-name" />
          <col className="jm-inputs-tab__col-type" />
          <col className="jm-inputs-tab__col-description" />
          <col className="jm-inputs-tab__col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Value</th>
            <th>Description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {attributes.map((attr, idx) => {
            const err = attrNameError(idx);
            return (
              <tr key={idx}>
                <td>
                  <input
                    type="text"
                    value={attr.name}
                    className={err ? "jm-inputs-tab__value-invalid" : undefined}
                    title={err ?? undefined}
                    onChange={(e) => updateAttr(idx, { name: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    value={attr.type}
                    onChange={(e) => updateAttr(idx, { type: e.target.value as WorkflowAttributeDef["type"], value: undefined })}
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="json-object">json object</option>
                    <option value="json-array">json array</option>
                  </select>
                </td>
                <td>
                  <AttributeValueField
                    type={attr.type}
                    value={attr.value}
                    onChange={(value) => updateAttr(idx, { value })}
                  />
                </td>
                <td>
                  <input type="text" value={attr.description ?? ""} onChange={(e) => updateAttr(idx, { description: e.target.value || undefined })} />
                </td>
                <td>
                  <button type="button" className="jm-inputs-tab__remove" onClick={() => removeAttr(idx)}>Remove</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" onClick={addAttr}>+ Add attribute</button>
    </div>
  );
}
