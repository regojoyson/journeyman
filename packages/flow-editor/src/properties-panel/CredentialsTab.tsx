import type { FlowNode } from "@journeyman/core";

export interface CredentialsTabProps {
  node: FlowNode;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

function getCredentials(node: FlowNode): Record<string, string> {
  const cfg = (node.config ?? {}) as { credentials?: Record<string, string> };
  return cfg.credentials ?? {};
}
function setCredentials(node: FlowNode, creds: Record<string, string>): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), credentials: creds } };
}

export function CredentialsTab({ node, onChange, readOnly }: CredentialsTabProps) {
  const creds = getCredentials(node);
  const rows = Object.entries(creds);

  const setRow = (oldKey: string | null, key: string, value: string) => {
    const next = { ...creds };
    if (oldKey && oldKey !== key) delete next[oldKey];
    if (key) next[key] = value;
    onChange(setCredentials(node, next));
  };
  const removeRow = (key: string) => {
    const next = { ...creds };
    delete next[key];
    onChange(setCredentials(node, next));
  };
  const addRow = () => {
    const next = { ...creds, "": "env:" };
    onChange(setCredentials(node, next));
  };

  return (
    <div>
      <div className="je-props__field">
        <label>Credential bindings</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.length === 0 && (
            <div style={{ color: "#666", fontSize: 11, fontStyle: "italic" }}>(none)</div>
          )}
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 4 }}>
              <input
                type="text"
                value={k}
                disabled={readOnly}
                placeholder="ENV_VAR"
                style={{ flex: 1, fontFamily: "ui-monospace, monospace" }}
                onChange={e => setRow(k, e.target.value, v)}
              />
              <input
                type="text"
                value={v}
                disabled={readOnly}
                placeholder="env:NAME or user:NAME"
                style={{ flex: 2, fontFamily: "ui-monospace, monospace" }}
                onChange={e => setRow(null, k, e.target.value)}
              />
              <button
                disabled={readOnly}
                onClick={() => removeRow(k)}
                style={{ background: "transparent", border: "1px solid #444", color: "#888", padding: "0 8px", borderRadius: 4, cursor: "pointer" }}
                title="Remove"
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
        <div style={{ fontSize: 10, color: "#888", marginTop: 6 }}>
          v1: <code>env:NAME</code> resolves to <code>process.env.NAME</code>. <code>user:</code> and <code>flow:</code> arrive in Phase 7.
        </div>
      </div>
    </div>
  );
}
