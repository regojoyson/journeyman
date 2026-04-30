// packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx
import { useEffect, useState, useMemo } from "react";
import type { FlowNode, SecretScope } from "@journeyman/core";
import { fetchVisibleSecrets, type VisibleSecret } from "../api/secrets.ts";
import { usePhaseRegistry } from "../state/phase-registry-context.tsx";

export interface RequiredSecretsTabProps {
  node: FlowNode;
  orgId: string;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

const SCOPE_LABEL: Record<SecretScope, string> = {
  user: "Your secrets",
  org: "Organization",
  global: "Global",
};
const SCOPE_ORDER: SecretScope[] = ["user", "org", "global"];

function getRequired(node: FlowNode): string[] {
  return node.requiredSecrets ?? [];
}
function setRequired(node: FlowNode, next: string[]): FlowNode {
  return { ...node, requiredSecrets: next };
}
function bestScopeFor(name: string, visible: VisibleSecret[]): SecretScope | null {
  // user > org > global precedence
  let best: SecretScope | null = null;
  for (const v of visible) {
    if (v.name !== name) continue;
    if (v.scope === "user") return "user";
    if (v.scope === "org") best = "org";
    else if (v.scope === "global" && best === null) best = "global";
  }
  return best;
}

export function RequiredSecretsTab({ node, orgId, onChange, readOnly }: RequiredSecretsTabProps) {
  const required = getRequired(node);
  const [visible, setVisible] = useState<VisibleSecret[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");

  const registry = usePhaseRegistry();
  const phaseDef = node.phaseType ? registry.get(node.phaseType) : undefined;
  const suggested = phaseDef?.defaultRequiredSecrets ?? [];
  const optional = phaseDef?.optionalSecrets ?? [];

  useEffect(() => {
    let cancelled = false;
    fetchVisibleSecrets(orgId).then(r => {
      if (!cancelled) { setVisible(r.scoped); setLoaded(true); }
    });
    return () => { cancelled = true; };
  }, [orgId]);

  const grouped = useMemo(() => {
    const out: Record<SecretScope, string[]> = { user: [], org: [], global: [] };
    for (const v of visible) {
      if (!out[v.scope].includes(v.name)) out[v.scope].push(v.name);
    }
    return out;
  }, [visible]);

  function add(name: string) {
    const trimmed = name.trim().toUpperCase();
    if (!trimmed) return;
    if (!NAME_RE.test(trimmed)) return;
    if (required.includes(trimmed)) return;
    onChange(setRequired(node, [...required, trimmed]));
    setDraft("");
  }
  function remove(name: string) {
    onChange(setRequired(node, required.filter(n => n !== name)));
  }

  return (
    <div>
      <div className="je-props__field">
        <label>Required secrets</label>
        <div style={{ fontSize: 10, color: "#888", marginBottom: 6 }}>
          Names of env-vars this step needs at run time. Resolved as <code>user &gt; org &gt; global</code>.
        </div>

        {(suggested.length > 0 || optional.length > 0) && (
          <div style={{
            fontSize: 11, color: "#aaa", marginBottom: 8,
            padding: "6px 8px", background: "#1f2433", border: "1px solid #2a3148",
            borderRadius: 4,
          }}>
            {suggested.length > 0 && (
              <div>
                <span style={{ color: "#7da7ff" }}>Typically needs:</span>{" "}
                {suggested.map((n, i) => (
                  <span key={n}>
                    <code style={{ fontFamily: "ui-monospace, monospace" }}>{n}</code>
                    {i < suggested.length - 1 ? ", " : ""}
                  </span>
                ))}
              </div>
            )}
            {optional.length > 0 && (
              <div style={{ marginTop: suggested.length > 0 ? 4 : 0 }}>
                <span style={{ color: "#9aaab9" }}>Optionally:</span>{" "}
                {optional.map((n, i) => (
                  <span key={n}>
                    <code style={{ fontFamily: "ui-monospace, monospace" }}>{n}</code>
                    {i < optional.length - 1 ? ", " : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Selected chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {required.length === 0 && (
            <div style={{ color: "#666", fontSize: 11, fontStyle: "italic" }}>(none)</div>
          )}
          {required.map(name => {
            const scope = bestScopeFor(name, visible);
            const accessible = scope !== null;
            return (
              <span
                key={name}
                title={
                  accessible
                    ? `Resolves from ${SCOPE_LABEL[scope!]}`
                    : "Not accessible to you. Create it in My Secrets or ask an admin."
                }
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 6px",
                  borderRadius: 3,
                  fontSize: 11,
                  fontFamily: "ui-monospace, monospace",
                  border: accessible ? "1px solid #444" : "1px solid #c08a3e",
                  background: accessible ? "#2a2a3e" : "#3a2e1a",
                  color: accessible ? "#ddd" : "#f0c97a",
                }}
              >
                {accessible ? "" : "⚠ "}{name}
                {accessible && (
                  <span style={{ fontSize: 9, color: "#888", textTransform: "uppercase" }}>
                    {scope}
                  </span>
                )}
                {!readOnly && (
                  <button
                    onClick={() => remove(name)}
                    style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", padding: 0, marginLeft: 2 }}
                    title="Remove"
                  >×</button>
                )}
              </span>
            );
          })}
        </div>

        {!readOnly && (
          <>
            {/* Grouped picker by scope */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
              {SCOPE_ORDER.map(scope => {
                const names = grouped[scope].filter(n => !required.includes(n));
                if (names.length === 0) return null;
                return (
                  <div key={scope}>
                    <div style={{
                      fontSize: 10, textTransform: "uppercase", color: "#888",
                      letterSpacing: 0.5, marginBottom: 3,
                    }}>{SCOPE_LABEL[scope]}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {names.map(n => (
                        <button
                          key={n}
                          onClick={() => add(n)}
                          style={{
                            background: "#1f1f2c", border: "1px solid #444",
                            color: "#bbb", padding: "2px 6px", borderRadius: 3,
                            fontSize: 11, fontFamily: "ui-monospace, monospace",
                            cursor: "pointer",
                          }}
                          title={`Add from ${SCOPE_LABEL[scope]}`}
                        >+ {n}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {loaded && grouped.user.length === 0 && grouped.org.length === 0 && grouped.global.length === 0 && (
                <div style={{ fontSize: 10, color: "#888" }}>
                  No secrets are currently accessible to you. Add one in <a href="/me/secrets">My Secrets</a> or ask an admin.
                </div>
              )}
            </div>

            {/* Free-text custom name */}
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                type="text"
                value={draft}
                placeholder="Or type a custom name (e.g. GITHUB_TOKEN)"
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { add(draft); e.preventDefault(); } }}
                style={{ flex: 1, fontFamily: "ui-monospace, monospace" }}
              />
              <button
                onClick={() => add(draft)}
                style={{ background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
              >
                + Add
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
