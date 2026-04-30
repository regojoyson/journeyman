// packages/flow-editor/src/properties-panel/SchemaForm.tsx
import type { ZodTypeAny } from "zod";
import type { ReactNode } from "react";
import type { FieldMeta } from "../phase-definition.ts";

export interface SchemaFormProps {
  config: Record<string, unknown>;
  fields: Record<string, FieldMeta>;
  schema?: ZodTypeAny;
  onChange: (next: Record<string, unknown>) => void;
  readOnly?: boolean;
  /** Keys whose value is supplied at runtime via a binding — input is replaced by the pill, errors suppressed. */
  boundKeys?: Set<string>;
  /** Renders the binding affordance (e.g. an `{x}` button) shown next to each field's label. */
  renderFieldBindControl?: (key: string) => ReactNode;
  /** Renders the bound-state pill that replaces the input when a key is bound. */
  renderBoundPill?: (key: string) => ReactNode;
}

export function SchemaForm({
  config, fields, schema, onChange, readOnly,
  boundKeys, renderFieldBindControl, renderBoundPill,
}: SchemaFormProps) {
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });

  const errors: Array<{ key: string; message: string }> = [];
  if (schema) {
    const parsed = schema.safeParse(config);
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        const key = String(i.path[0] ?? "");
        if (boundKeys?.has(key)) continue; // bound at runtime — skip
        errors.push({ key: key || "(root)", message: i.message });
      }
    }
  }

  return (
    <div>
      {Object.entries(fields).map(([key, meta]) => {
        const isBound = !!boundKeys?.has(key);
        if (meta.widget === "checkbox" && !isBound) {
          return (
            <div key={key} className="je-props__field">
              <label className="je-props__check-row">
                <input
                  type="checkbox"
                  checked={Boolean(config[key])}
                  disabled={readOnly}
                  onChange={e => set(key, e.target.checked)}
                />
                {meta.label}
              </label>
              {meta.help && <div className="je-props__field-help">{meta.help}</div>}
            </div>
          );
        }
        return (
          <div key={key} className="je-props__field">
            <div className="je-props__field-label-row">
              <label>{meta.label}</label>
              {renderFieldBindControl?.(key)}
            </div>
            {isBound && renderBoundPill ? (
              renderBoundPill(key)
            ) : (
              <FieldInput
                meta={meta}
                value={config[key]}
                disabled={readOnly}
                onChange={v => set(key, v)}
              />
            )}
            {meta.help && <div className="je-props__field-help">{meta.help}</div>}
          </div>
        );
      })}
      {errors.length > 0 && (
        <div className="je-props__field-error">
          {errors.map((e, i) => <div key={i}>{e.key}: {e.message}</div>)}
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
