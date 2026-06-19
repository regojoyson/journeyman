import { btnGhost, btnDanger, inputCls } from "../../routes/admin-styles.ts";
import { SecretPicker } from "./SecretPicker.tsx";

export interface Binding { envVar: string; secretName: string }

export interface BindingsEditorProps {
  wsId: string;
  value: Binding[];
  onChange: (next: Binding[]) => void;
  scope: "all" | "org-and-global";
}

export function BindingsEditor(props: BindingsEditorProps) {
  const update = (i: number, next: Partial<Binding>) => {
    const out = props.value.map((b, idx) => idx === i ? { ...b, ...next } : b);
    props.onChange(out);
  };
  const remove = (i: number) => props.onChange(props.value.filter((_, idx) => idx !== i));
  const add = () => props.onChange([...props.value, { envVar: "", secretName: "" }]);

  return (
    <div className="space-y-2">
      {props.value.map((b, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={inputCls + " flex-1"}
            placeholder="ENV_VAR"
            value={b.envVar}
            onChange={(e) => update(i, { envVar: e.target.value.toUpperCase() })}
          />
          <span className="text-slate-500">→</span>
          <div className="flex-1">
            <SecretPicker
              wsId={props.wsId}
              value={b.secretName}
              onChange={(name) => update(i, { secretName: name })}
              scope={props.scope}
            />
          </div>
          <button type="button" onClick={() => remove(i)} className={btnDanger}>✕</button>
        </div>
      ))}
      <button type="button" onClick={add} className={btnGhost}>+ Add binding</button>
    </div>
  );
}
