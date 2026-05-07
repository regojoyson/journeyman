import { useEffect, useMemo, useState } from "react";
import type { PhaseFormProps } from "@journeyman/flow-editor";
import { useOrgId, ValuePicker } from "@journeyman/flow-editor";
import type { CustomAiPhase, CanonicalTool, WorkflowInputValue } from "@journeyman/core";
import { CANONICAL_TOOLS, toolsRequireWorkspace } from "@journeyman/core";

interface CustomAiConfig {
  customPhaseId: string;
  mcpInstanceIds?: string[];
  skillIds?: string[];
  tools?: CanonicalTool[];
  inputs?: Record<string, WorkflowInputValue>;
}

export function CustomAiConfigForm({ config, onChange, readOnly, sources }: PhaseFormProps<CustomAiConfig>) {
  const orgId = useOrgId();
  const [phase, setPhase] = useState<CustomAiPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  useEffect(() => {
    if (!config.customPhaseId || !orgId) return;
    let alive = true;
    fetch(`/api/orgs/${orgId}/users/me/custom-phases/${config.customPhaseId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .catch(() =>
        fetch(`/api/orgs/${orgId}/custom-phases/${config.customPhaseId}`, { credentials: "include" })
          .then((r) => (r.ok ? r.json() : Promise.reject(r))),
      )
      .then((p) => { if (alive) setPhase(p as CustomAiPhase); })
      .catch((err) => { if (alive) setError(String(err)); });
    return () => { alive = false; };
  }, [orgId, config.customPhaseId]);

  const inputs = useMemo(() => config.inputs ?? {}, [config.inputs]);
  const setInputs = (next: Record<string, WorkflowInputValue>) => onChange({ ...config, inputs: next });

  if (!config.customPhaseId) {
    return <div className="je-props__field-help">No customPhaseId set on this node.</div>;
  }
  if (error) return <div className="je-props__field-help" style={{ color: "#ff7675" }}>{error}</div>;
  if (!phase) return <div className="je-props__field-help">Loading custom phase…</div>;

  const editHref = phase.scope === "user" ? "/me/custom-phases" : "/admin/custom-phases";
  const effectiveTools: CanonicalTool[] = config.tools ?? phase.defaultTools ?? [];
  const overriding = config.tools !== undefined;
  const needsWs = toolsRequireWorkspace(effectiveTools);

  const setOverride = (next: CanonicalTool[]) => onChange({ ...config, tools: next });
  const clearOverride = () => {
    const { tools: _t, ...rest } = config;
    onChange(rest as CustomAiConfig);
  };
  const toggleTool = (t: CanonicalTool) => {
    const cur = new Set(effectiveTools);
    if (cur.has(t)) cur.delete(t); else cur.add(t);
    setOverride([...cur]);
  };

  const setRef = (name: string, ref: string) => {
    setInputs({ ...inputs, [name]: { kind: "ref", ref } as WorkflowInputValue });
  };
  const getRef = (name: string): string => {
    const v = inputs[name];
    return v && v.kind === "ref" ? v.ref : "";
  };

  return (
    <div className="je-props__field" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label>Phase</label>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <strong>{phase.name}</strong>
          <span style={{ fontSize: 11, color: "#888" }}>({phase.scope})</span>
          <a
            href={editHref}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, marginLeft: "auto" }}
          >
            Edit definition →
          </a>
        </div>
        {phase.description && (
          <div className="je-props__field-help">{phase.description}</div>
        )}
      </div>

      <div className="je-props__field" style={{ position: "relative" }}>
        <label>Inputs</label>
        {phase.inputFields.length === 0 && (
          <div className="je-props__field-help">No inputs declared.</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {phase.inputFields.map((f) => {
            const ref = getRef(f.name);
            const isPicking = pickerFor === f.name;
            const empty = !ref;
            const showError = f.required && empty;
            return (
              <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                    {f.name}
                    {f.required && <span style={{ color: "#ff7675", marginLeft: 3 }}>*</span>}
                    <span style={{ color: "#888", marginLeft: 6, fontSize: 10 }}>{f.type}</span>
                  </span>
                  {f.description && (
                    <span style={{ fontSize: 10, color: "#666" }}>{f.description}</span>
                  )}
                </div>
                {ref ? (
                  <div className="je-props__bound-pill" style={{ flex: 2 }}>
                    <span className="je-props__bound-pill-icon" aria-hidden>↳</span>
                    <code className="je-props__bound-pill-ref">{ref}</code>
                    {!readOnly && (
                      <button
                        type="button"
                        className="je-props__bound-pill-unbind"
                        onClick={() => setRef(f.name, "")}
                        title="unbind"
                      >×</button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => setPickerFor(isPicking ? null : f.name)}
                    style={{
                      flex: 2,
                      background: "#2a2a3e",
                      border: showError ? "1px solid #ff7675" : "1px solid #444",
                      color: "#ddd",
                      padding: "4px 8px",
                      borderRadius: 4,
                      fontSize: 11,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {`{x} Pick value…`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {pickerFor !== null && (
          <div className="je-props__picker-popover">
            <ValuePicker
              sources={sources ?? []}
              onPick={(ref) => { setRef(pickerFor, ref); setPickerFor(null); }}
              onClose={() => setPickerFor(null)}
            />
          </div>
        )}
      </div>

      <div>
        <label>
          Tools{" "}
          {overriding ? (
            <span style={{ fontSize: 11, color: "#fdcb6e" }}>(overriding definition)</span>
          ) : (
            <span style={{ fontSize: 11, color: "#888" }}>(definition default)</span>
          )}
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {CANONICAL_TOOLS.map((t) => {
            const active = effectiveTools.includes(t);
            return (
              <label
                key={t}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  padding: "2px 6px",
                  border: "1px solid #444",
                  borderRadius: 4,
                  background: active ? "#4a9eff22" : "transparent",
                  cursor: readOnly ? "default" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={active}
                  onChange={() => toggleTool(t)}
                />
                {t}
              </label>
            );
          })}
        </div>
        {overriding && !readOnly && (
          <button
            type="button"
            onClick={clearOverride}
            style={{ marginTop: 6, fontSize: 11 }}
          >
            Reset to definition default
          </button>
        )}
        {needsWs && (
          <div className="je-props__field-help" style={{ marginTop: 4 }}>
            A workspace tool is selected — wire a <code>workspaceId</code> input on this node.
          </div>
        )}
      </div>

      <div>
        <label>Output preview</label>
        <pre
          style={{
            background: "#0f0f1a",
            color: "#94a3b8",
            padding: 8,
            fontSize: 11,
            border: "1px solid #2a2a3a",
            borderRadius: 4,
            maxHeight: 160,
            overflow: "auto",
          }}
        >
          {JSON.stringify(
            phase.outputMode === "structured"
              ? phase.outputSchema
              : phase.outputMode === "text"
                ? { result: "string" }
                : {},
            null,
            2,
          )}
        </pre>
      </div>
    </div>
  );
}
