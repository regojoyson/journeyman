import { useEffect, useMemo, useState } from "react";
import type { StepFormProps } from "@journeyman/flow-editor";
import {
  useOrgId,
  InputValueEditor,
  toMentionFields,
} from "@journeyman/flow-editor";
import type { CustomAiStep, CanonicalTool, WorkflowInputValue, Shape } from "@journeyman/core";

/** Expected shape for a custom-step bind field. Returns undefined only when the
 * target type is genuinely unconstrained. */
function expectedShapeForType(type: string): Shape | undefined {
  if (type === "string" || type === "workspaceDir") return { type: "string" };
  if (type === "number") return { type: "number" };
  if (type === "boolean") return { type: "boolean" };
  if (type === "json-object") return { type: "json", container: "object" };
  if (type === "json-array") return { type: "json", container: "array" };
  return undefined;
}

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
  const mentionFields = useMemo(() => toMentionFields(sources ?? []), [sources]);

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

  const editHref = "/me/custom-steps";
  const removeInput = (name: string) => {
    const next = { ...inputs };
    delete next[name];
    setInputs(next);
  };
  return (
    <div className="je-props__field" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label>Step</label>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <strong>{step.name}</strong>
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
          const v = inputs[f.name];
          const hasValue =
            v !== undefined && (
              (v.kind === "ref" && v.ref.trim() !== "") ||
              (v.kind === "literal" && v.value !== undefined) ||
              (v.kind === "template" && v.template.trim() !== "")
            );
          const showError = f.required && !hasValue;
          return (
            <div key={f.name} className={`je-props__field${showError ? " je-props__field--invalid" : ""}`}>
              <div className="je-props__field-label-row">
                <label>
                  {f.name}
                  {f.required && <span className="je-props__required-mark">*</span>}
                </label>
              </div>
              <InputValueEditor
                value={v}
                expected={expectedShapeForType(f.type)}
                fields={mentionFields}
                readOnly={readOnly}
                required={f.required}
                onChange={(next) => (next ? setInputs({ ...inputs, [f.name]: next }) : removeInput(f.name))}
              />
              {f.description && <div className="je-props__field-help">{f.description}</div>}
            </div>
          );
        })}
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
              ? (step.outputFields ?? [])
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
