import type { RunInputDef } from "@journeyman/core";

interface Props { value: RunInputDef[]; onChange: (next: RunInputDef[]) => void; }

export function RunInputsEditor({ value, onChange }: Props) {
  const update = (i: number, patch: Partial<RunInputDef>) =>
    onChange(value.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const add = () => onChange([...value, { name: "", type: "string" }]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  return (
    <div className="run-inputs-editor">
      <h4>Run inputs</h4>
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Description</th><th>Req</th><th></th></tr></thead>
        <tbody>
          {value.map((r, i) => (
            <tr key={i}>
              <td><input value={r.name} onChange={e => update(i, { name: e.target.value })} /></td>
              <td>
                <select value={r.type} onChange={e => update(i, { type: e.target.value as RunInputDef["type"] })}>
                  <option value="string">string</option><option value="number">number</option>
                  <option value="boolean">boolean</option><option value="json">json</option>
                </select>
              </td>
              <td><input value={r.description ?? ""} onChange={e => update(i, { description: e.target.value })} /></td>
              <td><input type="checkbox" checked={!!r.required} onChange={e => update(i, { required: e.target.checked })} /></td>
              <td><button onClick={() => remove(i)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={add}>+ Add input</button>
    </div>
  );
}
