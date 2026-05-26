import { useEffect, useMemo, useState } from "react";
import type { StepFormProps } from "@journeyman/flow-editor";
import {
  useOrgId,
  MentionInput,
  toMentionFields,
  parseTemplate,
  segmentsToTemplate,
  soleRefOf,
  type Segment,
} from "@journeyman/flow-editor";
import type { CustomAiStep, CanonicalTool, WorkflowInputValue, Shape } from "@journeyman/core";

/** Expected shape for a custom-step bind field. Returns undefined only when the
 * target type is genuinely unconstrained (generic array / repoRef). */
function expectedShapeForType(type: string): Shape | undefined {
  if (type === "string" || type === "workspaceDir") return { type: "string" };
  if (type === "number") return { type: "number" };
  if (type === "boolean") return { type: "boolean" };
  if (type === "string[]") return { type: "array", items: { type: "string" } };
  if (type === "object") return { type: "object", fields: {} };
  return undefined; // array (unknown items) / repoRef — stay permissive
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

  const editHref = step.scope === "user" ? "/me/custom-steps" : "/admin/custom-steps";
  const removeInput = (name: string) => {
    const next = { ...inputs };
    delete next[name];
    setInputs(next);
  };
  const setRef = (name: string, ref: string) => {
    if (!ref) { removeInput(name); return; }
    setInputs({ ...inputs, [name]: { kind: "ref", ref } as WorkflowInputValue });
  };
  const getRef = (name: string): string => {
    const v = inputs[name];
    return v && v.kind === "ref" ? v.ref : "";
  };
  const setTemplate = (name: string, template: string) => {
    if (!template) { removeInput(name); return; }
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
            const segs = parseTemplate(getTemplate(f.name), "braces");
            const showError = f.required && segs.length === 0;
            return (
              <div key={f.name} className={`je-props__field${showError ? " je-props__field--invalid" : ""}`}>
                <div className="je-props__field-label-row">
                  <label>
                    {f.name}
                    {f.required && <span className="je-props__required-mark">*</span>}
                  </label>
                </div>
                <MentionInput
                  value={segs}
                  fields={mentionFields}
                  readOnly={readOnly}
                  placeholder="Type, or @ to insert an upstream value"
                  onChange={(next: Segment[]) => setTemplate(f.name, segmentsToTemplate(next, "braces"))}
                />
                {f.description && <div className="je-props__field-help">{f.description}</div>}
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
              </div>
              <MentionInput
                value={ref ? [{ kind: "ref", ref }] : []}
                fields={mentionFields}
                readOnly={readOnly}
                expected={expectedShapeForType(f.type)}
                placeholder={f.required ? "Required — @ to bind from upstream" : "Optional — @ to bind"}
                onChange={(next: Segment[]) => setRef(f.name, soleRefOf(next) ?? "")}
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
