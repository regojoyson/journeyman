import type { CustomStepOutputMode, CustomStepOutputField } from "@journeyman/core";
import { btnGhost, inputCls, selectCls } from "../../routes/admin-styles.ts";

const TYPE_OPTIONS: { value: CustomStepOutputField["type"]; label: string }[] = [
  { value: "string", label: "string" },
  { value: "number", label: "number" },
  { value: "boolean", label: "boolean" },
  { value: "json-object", label: "json object" },
  { value: "json-array", label: "json array" },
];

export function OutputSchemaEditor(props: {
  mode: CustomStepOutputMode;
  fields: CustomStepOutputField[];
  onModeChange: (m: CustomStepOutputMode) => void;
  onFieldsChange: (f: CustomStepOutputField[]) => void;
}) {
  const { mode, fields, onModeChange, onFieldsChange } = props;

  const update = (i: number, patch: Partial<CustomStepOutputField>) =>
    onFieldsChange(fields.map((f, idx) => idx === i ? { ...f, ...patch } : f));
  const remove = (i: number) => onFieldsChange(fields.filter((_, idx) => idx !== i));
  const add = () => onFieldsChange([...fields, { name: "", type: "string", required: false }]);

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
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <select
                className={selectCls}
                value={f.type}
                onChange={(e) => update(i, { type: e.target.value as CustomStepOutputField["type"] })}
              >
                {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs text-slate-300 whitespace-nowrap">
                <input
                  type="checkbox"
                  className="accent-indigo-500"
                  checked={f.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                />
                required
              </label>
              <input
                className={inputCls}
                placeholder="description"
                value={f.description ?? ""}
                onChange={(e) => update(i, { description: e.target.value })}
              />
              <button
                type="button"
                className={btnGhost}
                onClick={() => remove(i)}
              >×</button>
            </div>
          ))}
          <button
            type="button"
            className={btnGhost}
            onClick={add}
          >+ Add output field</button>
        </div>
      )}
    </div>
  );
}
