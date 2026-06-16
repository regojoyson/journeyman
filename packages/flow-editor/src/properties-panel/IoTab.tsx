import { useMemo } from "react";
import type { WorkflowGraph, WorkflowNode, WorkflowInputValue } from "@journeyman/core";
import { MentionInput } from "./MentionInput.tsx";
import { toMentionFields } from "./mention-fields.ts";
import { soleRefOf, type Segment } from "./mention-serialize.ts";
import { useUpstreamSources, collectCustomStepIds } from "./use-upstream-sources.ts";
import { useStepCatalog } from "../catalogs/use-step-catalog.ts";
import { useCustomStepDefs } from "../catalogs/use-custom-step-defs.ts";
import { sanitizeRef } from "./sanitize-ref.ts";

export interface IoTabProps {
  flow: WorkflowGraph;
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

function getInputs(node: WorkflowNode): Record<string, WorkflowInputValue> {
  return (node.inputs ?? {}) as Record<string, WorkflowInputValue>;
}
function getOutputSchema(node: WorkflowNode): unknown {
  const cfg = (node.config ?? {}) as { outputSchema?: unknown };
  return cfg.outputSchema ?? {};
}
function setInputs(node: WorkflowNode, inputs: Record<string, WorkflowInputValue>): WorkflowNode {
  return { ...node, inputs };
}

function getRef(v: WorkflowInputValue): string {
  return v.kind === "ref" ? v.ref : "";
}
function setOutputSchema(node: WorkflowNode, schema: unknown): WorkflowNode {
  return { ...node, config: { ...(node.config ?? {}), outputSchema: schema } };
}

export function IoTab({ flow, node, onChange, readOnly }: IoTabProps) {
  const inputs = getInputs(node);
  const catalog = useStepCatalog();
  const customStepDefs = useCustomStepDefs(collectCustomStepIds(flow));
  const sources = useUpstreamSources(flow, node.id, catalog, customStepDefs);
  const mentionFields = useMemo(() => toMentionFields(sources), [sources]);

  const renameKey = (oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    const next: Record<string, WorkflowInputValue> = {};
    for (const [k, v] of Object.entries(inputs)) {
      next[k === oldKey ? newKey : k] = v;
    }
    onChange(setInputs(node, next));
  };
  const setRef = (key: string, ref: string) => {
    const clean = sanitizeRef(ref);
    const next = { ...inputs, [key]: { kind: "ref", ref: clean } as WorkflowInputValue };
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
            return (
              <div key={k} style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
                <input
                  type="text" value={k}
                  disabled={readOnly}
                  placeholder="inputName"
                  style={{ flex: 1, fontFamily: "ui-monospace, monospace" }}
                  onChange={e => renameKey(k, e.target.value)}
                />
                <div style={{ flex: 2 }}>
                  <MentionInput
                    value={ref ? [{ kind: "ref", ref }] : []}
                    fields={mentionFields}
                    readOnly={readOnly}
                    placeholder="@ to pick a value"
                    onChange={(segs: Segment[]) => setRef(k, soleRefOf(segs) ?? "")}
                  />
                </div>
                <button
                  disabled={readOnly}
                  onClick={() => removeRow(k)}
                  style={{ background: "transparent", border: "1px solid rgb(var(--color-border) / 1)", color: "rgb(var(--color-text-muted) / 1)", padding: "0 8px", borderRadius: 4, cursor: "pointer" }}
                >×</button>
              </div>
            );
          })}
        </div>
        {!readOnly && (
          <button
            onClick={addRow}
            style={{ marginTop: 6, background: "rgb(var(--color-surface-raised) / 1)", border: "1px solid rgb(var(--color-border) / 1)", color: "rgb(var(--color-text) / 1)", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
          >+ Add</button>
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
