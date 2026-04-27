import type { FlowGraph, FlowNode, NodeInputBinding } from "@journeyman/core";

export interface IoTabProps {
  flow: FlowGraph;
  node: FlowNode;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

function getInputs(node: FlowNode): Record<string, NodeInputBinding> {
  const cfg = (node.config ?? {}) as { inputs?: Record<string, NodeInputBinding> };
  return cfg.inputs ?? {};
}
function getOutputSchema(node: FlowNode): unknown {
  const cfg = (node.config ?? {}) as { outputSchema?: unknown };
  return cfg.outputSchema ?? {};
}
function setInputs(node: FlowNode, inputs: Record<string, NodeInputBinding>): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), inputs } };
}
function setOutputSchema(node: FlowNode, schema: unknown): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), outputSchema: schema } };
}

function upstreamNodeIds(flow: FlowGraph, nodeId: string): string[] {
  const incoming = new Map<string, string[]>();
  for (const e of flow.edges) {
    const arr = incoming.get(e.target) ?? [];
    arr.push(e.source);
    incoming.set(e.target, arr);
  }
  const out = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const src of incoming.get(cur) ?? []) {
      if (!out.has(src)) { out.add(src); stack.push(src); }
    }
  }
  return [...out];
}

export function IoTab({ flow, node, onChange, readOnly }: IoTabProps) {
  const inputs = getInputs(node);
  const upstream = upstreamNodeIds(flow, node.id);

  const setRow = (oldKey: string | null, key: string, from: string) => {
    const next = { ...inputs };
    if (oldKey && oldKey !== key) delete next[oldKey];
    if (key) next[key] = { from };
    onChange(setInputs(node, next));
  };
  const removeRow = (key: string) => {
    const next = { ...inputs };
    delete next[key];
    onChange(setInputs(node, next));
  };
  const addRow = () => onChange(setInputs(node, { ...inputs, "": { from: "" } }));

  return (
    <div>
      <div className="je-props__field">
        <label>Inputs (wire from upstream nodes)</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {Object.entries(inputs).map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 4 }}>
              <input
                type="text" value={k}
                disabled={readOnly}
                placeholder="inputName"
                style={{ flex: 1, fontFamily: "ui-monospace, monospace" }}
                onChange={e => setRow(k, e.target.value, v.from)}
              />
              <input
                type="text" value={v.from}
                disabled={readOnly}
                placeholder="step1.output.foo"
                style={{ flex: 2, fontFamily: "ui-monospace, monospace" }}
                onChange={e => setRow(null, k, e.target.value)}
              />
              <button
                disabled={readOnly}
                onClick={() => removeRow(k)}
                style={{ background: "transparent", border: "1px solid #444", color: "#888", padding: "0 8px", borderRadius: 4, cursor: "pointer" }}
              >×</button>
            </div>
          ))}
        </div>
        {!readOnly && (
          <button
            onClick={addRow}
            style={{ marginTop: 6, background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
          >+ Add</button>
        )}
        {upstream.length > 0 && (
          <div style={{ fontSize: 10, color: "#888", marginTop: 6 }}>
            Upstream: {upstream.join(", ")} · also <code>$flow.input.&lt;name&gt;</code>
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
