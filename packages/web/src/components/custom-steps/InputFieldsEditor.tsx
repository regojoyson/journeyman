import type { CustomStepInputField, CustomStepInputType } from "@journeyman/core";
import { btnGhost, inputCls, selectCls } from "../../routes/admin-styles.ts";

const TYPES: { value: CustomStepInputType; label: string }[] = [
  { value: "string", label: "string" },
  { value: "number", label: "number" },
  { value: "boolean", label: "boolean" },
  { value: "json-object", label: "json object" },
  { value: "json-array", label: "json array" },
  { value: "workspaceDir", label: "workspaceDir" },
];

export function InputFieldsEditor(props: {
  value: CustomStepInputField[];
  onChange: (next: CustomStepInputField[]) => void;
}) {
  const { value, onChange } = props;
  const update = (i: number, patch: Partial<CustomStepInputField>) => {
    onChange(value.map((f, idx) => idx === i ? { ...f, ...patch } : f));
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { name: "", type: "string", required: false }]);

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-xs text-slate-500">No inputs yet.</p>
      )}
      {value.map((f, i) => (
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
            onChange={(e) => update(i, { type: e.target.value as CustomStepInputType })}
          >
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
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
          <button type="button" className={btnGhost} onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <button type="button" className={btnGhost} onClick={add}>+ Add input</button>
    </div>
  );
}
