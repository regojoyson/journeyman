import { Plus, Trash2 } from "lucide-react";
import type { WorkflowInputDef } from "@journeyman/core";

interface Props { value: WorkflowInputDef[]; onChange: (next: WorkflowInputDef[]) => void; }

const TYPE_OPTIONS: { value: WorkflowInputDef["type"]; label: string }[] = [
  { value: "string", label: "string" },
  { value: "number", label: "number" },
  { value: "boolean", label: "boolean" },
  { value: "json-object", label: "json object" },
  { value: "json-array", label: "json array" },
];

export function RunInputsEditor({ value, onChange }: Props) {
  const update = (i: number, patch: Partial<WorkflowInputDef>) =>
    onChange(value.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const add = () => onChange([...value, { name: "", type: "string" }]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="je-run-inputs">
      <div className="je-run-inputs__header">
        <h4 className="je-run-inputs__title">Run inputs</h4>
        <span className="je-run-inputs__count">{value.length}</span>
      </div>

      {value.length === 0 && (
        <div className="je-run-inputs__empty">
          No run inputs yet. Add one below to collect values when this flow is started.
        </div>
      )}

      <ul className="je-run-inputs__list">
        {value.map((r, i) => (
          <li key={i} className="je-run-inputs__card">
            <div className="je-run-inputs__row">
              <div className="je-run-inputs__field je-run-inputs__field--grow">
                <label htmlFor={`run-input-name-${i}`}>Name</label>
                <input
                  id={`run-input-name-${i}`}
                  className="je-run-inputs__input"
                  placeholder="e.g. jira:PROJ-123"
                  value={r.name}
                  onChange={e => update(i, { name: e.target.value })}
                />
              </div>
              <div className="je-run-inputs__field je-run-inputs__field--type">
                <label htmlFor={`run-input-type-${i}`}>Type</label>
                <select
                  id={`run-input-type-${i}`}
                  className="je-run-inputs__input"
                  value={r.type}
                  onChange={e => update(i, { type: e.target.value as WorkflowInputDef["type"] })}
                >
                  {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>

            <div className="je-run-inputs__field">
              <label htmlFor={`run-input-desc-${i}`}>Description</label>
              <input
                id={`run-input-desc-${i}`}
                className="je-run-inputs__input"
                placeholder="What is this input for?"
                value={r.description ?? ""}
                onChange={e => update(i, { description: e.target.value })}
              />
            </div>

            <div className="je-run-inputs__footer">
              <label className="je-switch">
                <input
                  type="checkbox"
                  checked={!!r.required}
                  onChange={e => update(i, { required: e.target.checked })}
                />
                <span className="je-switch__track" aria-hidden="true">
                  <span className="je-switch__thumb" />
                </span>
                <span className="je-switch__label">Required</span>
              </label>
              <button
                type="button"
                className="je-run-inputs__remove"
                onClick={() => remove(i)}
                aria-label={`Remove input ${r.name || i + 1}`}
                title="Remove this input"
              >
                <Trash2 size={14} aria-hidden="true" focusable="false" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button type="button" className="je-run-inputs__add" onClick={add}>
        <Plus size={14} aria-hidden="true" focusable="false" />
        <span>Add input</span>
      </button>
    </div>
  );
}
