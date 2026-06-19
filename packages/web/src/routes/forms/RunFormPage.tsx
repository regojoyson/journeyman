import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getForm, submitForm, type FormSchema, type FormField } from "../../api/forms.ts";

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.widget) {
    case "textarea":
      return <textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return (
        <input
          type="number"
          value={value == null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "select":
      return (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">— select —</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "text":
    default:
      return <input type="text" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function RunFormPage() {
  const { id: workflowId, wsId = "" } = useParams<{ id: string; wsId: string }>();
  const nav = useNavigate();
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!workflowId) return;
    getForm(workflowId)
      .then(setSchema)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [workflowId]);

  if (error) return <div style={{ padding: 24, color: "rgb(var(--color-danger) / 1)" }}>Error: {error}</div>;
  if (!schema) return <div style={{ padding: 24, color: "rgb(var(--color-text-muted) / 1)" }}>Loading…</div>;

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!workflowId) return;
    setSubmitting(true);
    setError(null);
    try {
      const { workflowInstanceId } = await submitForm(workflowId, values);
      nav(`/workspaces/${wsId}/workflow-instances/${workflowInstanceId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="jm-run-form" onSubmit={onSubmit} style={{ padding: 24 }}>
      <h1>{schema.title}</h1>
      {schema.fields.map((f) => (
        <label key={f.name} className="jm-run-form-field" style={{ display: "block", marginBottom: 12 }}>
          <span>
            {f.label}
            {f.required ? " *" : ""}
          </span>
          <div>
            <FieldInput
              field={f}
              value={values[f.name]}
              onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))}
            />
          </div>
          {f.description ? <small>{f.description}</small> : null}
        </label>
      ))}
      <button type="submit" disabled={submitting}>
        {submitting ? "Submitting…" : "Start"}
      </button>
    </form>
  );
}
