import { useState } from "react";
import type { FlowGraph, FlowNode, FlowInputValue } from "@journeyman/core";
import { ValuePicker } from "./ValuePicker.tsx";
import { useUpstreamSources } from "./use-upstream-sources.ts";
import { usePhaseCatalog } from "../catalogs/use-phase-catalog.ts";

export interface IoTabProps {
  flow: FlowGraph;
  node: FlowNode;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

function getInputs(node: FlowNode): Record<string, FlowInputValue> {
  const cfg = (node.config ?? {}) as { inputs?: Record<string, FlowInputValue> };
  return cfg.inputs ?? {};
}
function getOutputSchema(node: FlowNode): unknown {
  const cfg = (node.config ?? {}) as { outputSchema?: unknown };
  return cfg.outputSchema ?? {};
}
function setInputs(node: FlowNode, inputs: Record<string, FlowInputValue>): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), inputs } };
}

function getRef(v: FlowInputValue): string {
  return v.kind === "ref" ? v.ref : "";
}
function setOutputSchema(node: FlowNode, schema: unknown): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), outputSchema: schema } };
}

export function IoTab({ flow, node, onChange, readOnly }: IoTabProps) {
  const inputs = getInputs(node);
  const catalog = usePhaseCatalog();
  const sources = useUpstreamSources(flow, node.id, catalog);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const renameKey = (oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    const next: Record<string, FlowInputValue> = {};
    for (const [k, v] of Object.entries(inputs)) {
      next[k === oldKey ? newKey : k] = v;
    }
    onChange(setInputs(node, next));
  };
  const setRef = (key: string, ref: string) => {
    const next = { ...inputs, [key]: { kind: "ref", ref } as FlowInputValue };
    onChange(setInputs(node, next));
  };
  const removeRow = (key: string) => {
    const next = { ...inputs };
    delete next[key];
    onChange(setInputs(node, next));
  };
  const addRow = () => onChange(setInputs(node, { ...inputs, "": { kind: "ref", ref: "" } }));

  return (
    <div>
      <div className="je-props__field" style={{ position: "relative" }}>
        <label>Inputs (wire from upstream nodes)</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {Object.entries(inputs).map(([k, v]) => {
            const ref = getRef(v);
            const isPicking = pickerFor === k;
            return (
              <div key={k} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input
                  type="text" value={k}
                  disabled={readOnly}
                  placeholder="inputName"
                  style={{ flex: 1, fontFamily: "ui-monospace, monospace" }}
                  onChange={e => renameKey(k, e.target.value)}
                />
                {ref ? (
                  <div className="je-props__bound-pill" style={{ flex: 2 }}>
                    <span className="je-props__bound-pill-icon" aria-hidden>↳</span>
                    <code className="je-props__bound-pill-ref">{ref}</code>
                    {!readOnly && (
                      <button
                        type="button"
                        className="je-props__bound-pill-unbind"
                        onClick={() => setRef(k, "")}
                        title="unbind"
                      >×</button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => setPickerFor(isPicking ? null : k)}
                    style={{ flex: 2, background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer", textAlign: "left" }}
                  >
                    {`{x} Pick value…`}
                  </button>
                )}
                <button
                  disabled={readOnly}
                  onClick={() => removeRow(k)}
                  style={{ background: "transparent", border: "1px solid #444", color: "#888", padding: "0 8px", borderRadius: 4, cursor: "pointer" }}
                >×</button>
              </div>
            );
          })}
        </div>
        {!readOnly && (
          <button
            onClick={addRow}
            style={{ marginTop: 6, background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
          >+ Add</button>
        )}
        {pickerFor !== null && (
          <div className="je-props__picker-popover">
            <ValuePicker
              sources={sources}
              onPick={ref => { setRef(pickerFor, ref); setPickerFor(null); }}
              onClose={() => setPickerFor(null)}
            />
          </div>
        )}
      </div>

      <div className="je-props__field">
        <label>Output schema (JSON)</label>
        <textarea
          value={JSON.stringify(getOutputSchema(node), null, 2)}
          disabled={readOnly}
          onChange={e => {
            try { onChange(setOutputSchema(node, JSON.parse(e.target.value || "{}"))); }
            catch { /* invalid JSON — leave as-is */ }
          }}
        />
      </div>
    </div>
  );
}
