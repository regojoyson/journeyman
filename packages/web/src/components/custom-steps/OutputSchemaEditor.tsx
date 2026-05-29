import { useEffect, useRef, useState } from "react";
import type { CustomStepOutputMode, CustomStepJsonSchema } from "@journeyman/core";
import { btnGhost, inputCls, selectCls } from "../../routes/admin-styles.ts";

interface SchemaField {
  name: string;
  type: "string" | "number" | "boolean" | "json-array" | "json-object";
  required: boolean;
  description?: string;
}

const TYPE_OPTIONS: { value: SchemaField["type"]; label: string }[] = [
  { value: "string", label: "string" },
  { value: "number", label: "number" },
  { value: "boolean", label: "boolean" },
  { value: "json-object", label: "json object" },
  { value: "json-array", label: "json array" },
];

export function OutputSchemaEditor(props: {
  mode: CustomStepOutputMode;
  schema: CustomStepJsonSchema | undefined;
  onModeChange: (m: CustomStepOutputMode) => void;
  onSchemaChange: (s: CustomStepJsonSchema | undefined) => void;
}) {
  const { mode, schema, onModeChange, onSchemaChange } = props;

  // Local state for editor rows so empty-name rows aren't dropped on
  // round-trip through JSON Schema (which can't have empty property names).
  const [fields, setFields] = useState<SchemaField[]>(() => parseSchema(schema));
  const lastEmitted = useRef<string>("");

  // Sync from props only when the incoming schema differs from what we last
  // emitted (i.e. an external change, not our own write).
  useEffect(() => {
    const incoming = JSON.stringify(schema ?? null);
    if (incoming !== lastEmitted.current) {
      setFields(parseSchema(schema));
    }
  }, [schema]);

  const apply = (next: SchemaField[]) => {
    setFields(next);
    const built = buildSchema(next);
    lastEmitted.current = JSON.stringify(built ?? null);
    onSchemaChange(built);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400">Output mode</span>
        <select
          className={selectCls}
          value={mode}
          onChange={(e) => onModeChange(e.target.value as CustomStepOutputMode)}
        >
          <option value="none">None</option>
          <option value="text">Text</option>
          <option value="structured">Structured</option>
        </select>
      </div>

      {mode === "structured" && (
        <div className="space-y-2">
          {fields.length === 0 && (
            <p className="text-xs text-slate-500">No output fields yet.</p>
          )}
          {fields.map((f, i) => (
            <div key={i} className="grid grid-cols-[1.2fr_1fr_auto_2fr_auto] gap-2 items-center">
              <input
                className={inputCls}
                placeholder="name"
                value={f.name}
                onChange={(e) => apply(fields.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
              />
              <select
                className={selectCls}
                value={f.type}
                onChange={(e) => apply(fields.map((x, idx) => idx === i ? { ...x, type: e.target.value as SchemaField["type"] } : x))}
              >
                {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs text-slate-300 whitespace-nowrap">
                <input
                  type="checkbox"
                  className="accent-indigo-500"
                  checked={f.required}
                  onChange={(e) => apply(fields.map((x, idx) => idx === i ? { ...x, required: e.target.checked } : x))}
                />
                required
              </label>
              <input
                className={inputCls}
                placeholder="description"
                value={f.description ?? ""}
                onChange={(e) => apply(fields.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))}
              />
              <button
                type="button"
                className={btnGhost}
                onClick={() => apply(fields.filter((_, idx) => idx !== i))}
              >×</button>
            </div>
          ))}
          <button
            type="button"
            className={btnGhost}
            onClick={() => apply([...fields, { name: "", type: "string", required: false }])}
          >+ Add output field</button>
        </div>
      )}
    </div>
  );
}

/** JSON Schema scalar/container type → editor field type. */
function jsonSchemaTypeToField(t: unknown): SchemaField["type"] {
  switch (t) {
    case "number":
    case "integer": return "number";
    case "boolean": return "boolean";
    case "array":   return "json-array";
    case "object":  return "json-object";
    default:        return "string";
  }
}

/** Editor field type → JSON Schema type. */
function fieldTypeToJsonSchema(t: SchemaField["type"]): "string" | "number" | "boolean" | "array" | "object" {
  switch (t) {
    case "number":      return "number";
    case "boolean":     return "boolean";
    case "json-array":  return "array";
    case "json-object": return "object";
    case "string":      return "string";
  }
}

function parseSchema(s: CustomStepJsonSchema | undefined): SchemaField[] {
  if (!s || typeof s !== "object") return [];
  const required = new Set<string>(Array.isArray((s as any).required) ? (s as any).required : []);
  const props = (s as any).properties ?? {};
  return Object.entries(props).map(([name, p]: [string, any]) => ({
    name,
    type: jsonSchemaTypeToField(p?.type),
    required: required.has(name),
    description: p?.description,
  }));
}

function buildSchema(fields: SchemaField[]): CustomStepJsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of fields) {
    if (!f.name) continue;
    properties[f.name] = { type: fieldTypeToJsonSchema(f.type), ...(f.description ? { description: f.description } : {}) };
    if (f.required) required.push(f.name);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}
