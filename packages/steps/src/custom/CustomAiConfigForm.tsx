import { useEffect, useMemo, useRef, useState } from "react";
import type { StepFormProps } from "@journeyman/flow-editor";
import { useOrgId, ValuePicker } from "@journeyman/flow-editor";
import type { CustomAiStep, CanonicalTool, WorkflowInputValue } from "@journeyman/core";

interface CustomAiConfig {
  customStepId: string;
  mcpInstanceIds?: string[];
  skillIds?: string[];
  tools?: CanonicalTool[];
}

export function CustomAiConfigForm({ config, onChange, readOnly, sources, inputs: nodeInputs, onInputsChange }: StepFormProps<CustomAiConfig>) {
  const orgId = useOrgId();
  const [step, setStep] = useState<CustomAiStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [templateInsertFor, setTemplateInsertFor] = useState<string | null>(null);
  const cursorByField = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!config.customStepId || !orgId) return;
    let alive = true;
    fetch(`/api/orgs/${orgId}/users/me/custom-steps/${config.customStepId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .catch(() =>
        fetch(`/api/orgs/${orgId}/custom-steps/${config.customStepId}`, { credentials: "include" })
          .then((r) => (r.ok ? r.json() : Promise.reject(r))),
      )
      .then((p) => { if (alive) setStep(p as CustomAiStep); })
      .catch((err) => { if (alive) setError(String(err)); });
    return () => { alive = false; };
  }, [orgId, config.customStepId]);

  const inputs = useMemo(() => (nodeInputs ?? {}) as Record<string, WorkflowInputValue>, [nodeInputs]);
  const setInputs = (next: Record<string, WorkflowInputValue>) => onInputsChange?.(next);

  if (!config.customStepId) {
    return <div className="je-props__field-help">No customStepId set on this node.</div>;
  }
  if (error) return <div className="je-props__field-help" style={{ color: "#ff7675" }}>{error}</div>;
  if (!step) return <div className="je-props__field-help">Loading custom step…</div>;

  const editHref = step.scope === "user" ? "/me/custom-steps" : "/admin/custom-steps";
  const setRef = (name: string, ref: string) => {
    setInputs({ ...inputs, [name]: { kind: "ref", ref } as WorkflowInputValue });
  };
  const getRef = (name: string): string => {
    const v = inputs[name];
    return v && v.kind === "ref" ? v.ref : "";
  };
  const setTemplate = (name: string, template: string) => {
    setInputs({ ...inputs, [name]: { kind: "template", template } as WorkflowInputValue });
  };
  const getTemplate = (name: string): string => {
    const v = inputs[name];
    return v && v.kind === "template" ? v.template : "";
  };

  return (
    <div className="je-props__field" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label>Step</label>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <strong>{step.name}</strong>
          <span style={{ fontSize: 11, color: "#888" }}>({step.scope})</span>
          <a
            href={editHref}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, marginLeft: "auto" }}
          >
            Edit definition →
          </a>
        </div>
        {step.description && (
          <div className="je-props__field-help">{step.description}</div>
        )}
      </div>

      <div style={{ position: "relative" }}>
        <div className="je-props__bind-only-title">Inputs</div>
        {step.inputFields.length === 0 && (
          <div className="je-props__field-help">No inputs declared.</div>
        )}
        {step.inputFields.map((f) => {
          if (f.type === "template") {
            const tpl = getTemplate(f.name);
            const empty = tpl.trim().length === 0;
            const showError = f.required && empty;
            const insertOpen = templateInsertFor === f.name;
            return (
              <div key={f.name} className="je-props__field" style={{ position: "relative" }}>
                <div className="je-props__field-label-row">
                  <label>
                    {f.name}
                    {f.required && <span className="je-props__required-mark">*</span>}
                  </label>
                  <button
                    type="button"
                    disabled={readOnly}
                    className="je-props__bind-icon"
                    onClick={() => setTemplateInsertFor(insertOpen ? null : f.name)}
                    title="insert upstream value"
                  >
                    {`{x}`}
                  </button>
                </div>
                <textarea
                  value={tpl}
                  disabled={readOnly}
                  rows={4}
                  onChange={(e) => {
                    cursorByField.current[f.name] = e.target.selectionStart;
                    setTemplate(f.name, e.target.value);
                  }}
                  onSelect={(e) => {
                    cursorByField.current[f.name] = (e.target as HTMLTextAreaElement).selectionStart;
                  }}
                  style={{
                    borderColor: showError ? "#ff7675" : undefined,
                  }}
                />
                {f.description && <div className="je-props__field-help">{f.description}</div>}
                {insertOpen && (
                  <div className="je-props__picker-popover">
                    <ValuePicker
                      sources={sources ?? []}
                      onPick={(ref) => {
                        const pos = cursorByField.current[f.name] ?? tpl.length;
                        const next = tpl.slice(0, pos) + `{{${ref}}}` + tpl.slice(pos);
                        setTemplate(f.name, next);
                        setTemplateInsertFor(null);
                      }}
                      onClose={() => setTemplateInsertFor(null)}
                    />
                  </div>
                )}
              </div>
            );
          }

          const ref = getRef(f.name);
          const isBound = !!ref;
          const showError = f.required && !isBound;
          return (
            <div key={f.name} className={`je-props__field${showError ? " je-props__field--invalid" : ""}`}>
              <div className="je-props__field-label-row">
                <label>
                  {f.name}
                  {f.required && <span className="je-props__required-mark">*</span>}
                </label>
                {!readOnly && (
                  <button
                    type="button"
                    className={`je-props__bind-icon${isBound ? " je-props__bind-icon--bound" : ""}`}
                    onClick={() => setPickerFor(pickerFor === f.name ? null : f.name)}
                    title={isBound ? `bound to ${ref}` : "bind to upstream value"}
                  >
                    {`{x}`}
                  </button>
                )}
              </div>
              {isBound ? (
                <div className="je-props__bound-pill">
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
                <div className="je-props__bind-only-empty">
                  {f.required ? "Required — bind from upstream" : "Optional — not bound"}
                </div>
              )}
              {f.description && <div className="je-props__field-help">{f.description}</div>}
            </div>
          );
        })}
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
            step.outputMode === "structured"
              ? step.outputSchema
              : step.outputMode === "text"
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
