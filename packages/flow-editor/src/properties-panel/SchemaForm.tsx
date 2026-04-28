// packages/flow-editor/src/properties-panel/SchemaForm.tsx
import type { ZodTypeAny } from "zod";
import type { FieldMeta } from "../phase-definition.ts";

export interface SchemaFormProps {
  config: Record<string, unknown>;
  fields: Record<string, FieldMeta>;
  schema?: ZodTypeAny;
  onChange: (next: Record<string, unknown>) => void;
  readOnly?: boolean;
}

export function SchemaForm({ config, fields, schema, onChange, readOnly }: SchemaFormProps) {
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });

  const errors: string[] = [];
  if (schema) {
    const parsed = schema.safeParse(config);
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        errors.push(`${i.path.join(".") || "(root)"}: ${i.message}`);
      }
    }
  }

  return (
    <div>
      {Object.entries(fields).map(([key, meta]) => (
        <div key={key} className="je-props__field">
          <label>{meta.label}</label>
          <FieldInput
            meta={meta}
            value={config[key]}
            disabled={readOnly}
            onChange={v => set(key, v)}
          />
          {meta.help && <div style={{ fontSize: 11, color: "#888" }}>{meta.help}</div>}
        </div>
      ))}
      {errors.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#ff7675" }}>
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}
    </div>
  );
}

function FieldInput(
  { meta, value, disabled, onChange }: {
    meta: FieldMeta;
    value: unknown;
    disabled?: boolean;
    onChange: (v: unknown) => void;
  },
) {
  const widget = meta.widget ?? "text";
  switch (widget) {
    case "textarea":
      return (
        <textarea
          value={(value as string) ?? ""}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <input
          type="number"
          value={(value as number | undefined) ?? ""}
          disabled={disabled}
          onChange={e => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={e => onChange(e.target.checked)}
        />
      );
    case "select":
      return (
        <select
          value={(value as string) ?? ""}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        >
          <option value="">—</option>
          {(meta.options ?? []).map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    case "secret":
      return (
        <input
          type="password"
          value={(value as string) ?? ""}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        />
      );
    case "code":
      return (
        <textarea
          value={(value as string) ?? ""}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          style={{ fontFamily: "monospace" }}
        />
      );
    case "text":
    default:
      return (
        <input
          type="text"
          value={(value as string) ?? ""}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        />
      );
  }
}
