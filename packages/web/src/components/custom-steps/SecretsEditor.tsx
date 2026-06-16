import { useState } from "react";
import type { SecretSlotDef } from "@journeyman/core";
import { KeyRound, Plus, Trash2, AlertTriangle } from "lucide-react";
import { btnGhost, inputCls } from "../../routes/admin-styles.ts";

const NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;
const RESERVED = new Set(["PATH", "HOME", "USER", "SHELL", "PWD"]);

export interface SecretsEditorProps {
  value: SecretSlotDef[];
  onChange: (next: SecretSlotDef[]) => void;
  hasBashTool: boolean;
}

function validate(s: SecretSlotDef, existing: SecretSlotDef[]): string | null {
  if (!s.name.trim()) return "Name is required";
  if (!NAME_REGEX.test(s.name)) return "Name must be SCREAMING_SNAKE_CASE";
  if (s.name.startsWith("JM_")) return "Name must not start with JM_";
  if (RESERVED.has(s.name)) return "Name shadows a reserved env variable";
  if (existing.some(e => e.name === s.name)) return "Slot name already used";
  if (!s.description.trim()) return "Description is required";
  return null;
}

export function SecretsEditor({ value, onChange, hasBashTool }: SecretsEditorProps) {
  const [draft, setDraft] = useState<SecretSlotDef>({ name: "", description: "" });
  const [error, setError] = useState<string | null>(null);

  function add() {
    const err = validate(draft, value);
    if (err) { setError(err); return; }
    onChange([...value, draft]);
    setDraft({ name: "", description: "" });
    setError(null);
  }

  function remove(name: string) {
    onChange(value.filter(s => s.name !== name));
  }

  function toggleOptional(name: string) {
    onChange(value.map(s => s.name === name ? { ...s, optional: !s.optional } : s));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 text-xs text-slate-400">
        <KeyRound className="w-4 h-4 mt-0.5 text-slate-500 shrink-0" />
        <p>
          Declare credentials this step needs. Each slot becomes a{" "}
          <code className="text-accent bg-accent/10 px-1 py-0.5 rounded text-[11px]">$SLOT_NAME</code>{" "}
          environment variable in the Bash tool. Flow authors bind each slot to a
          specific secret when adding this step to a workflow.
        </p>
      </div>

      {!hasBashTool && value.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-800/60 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Slots are declared but the <code>bash</code> tool isn't selected — env values
            won't be reachable at runtime. Enable <code>bash</code> in Tools above.
          </span>
        </div>
      )}

      {value.length > 0 && (
        <div className="rounded-md border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium w-[28%]">Name</th>
                <th className="text-left px-3 py-2 font-medium">Description</th>
                <th className="text-center px-3 py-2 font-medium w-[90px]">Optional</th>
                <th className="w-[44px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {value.map(slot => (
                <tr key={slot.name} className="group hover:bg-slate-900/40 transition">
                  <td className="px-3 py-2 align-top">
                    <code className="font-mono text-[13px] text-accent">{slot.name}</code>
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-slate-300">
                    {slot.description}
                  </td>
                  <td className="px-3 py-2 align-middle text-center">
                    <input
                      type="checkbox"
                      className="accent-indigo-500"
                      checked={!!slot.optional}
                      onChange={() => toggleOptional(slot.name)}
                    />
                  </td>
                  <td className="px-2 py-2 align-middle text-right">
                    <button
                      type="button"
                      onClick={() => remove(slot.name)}
                      className="p-1.5 rounded text-slate-500 hover:text-danger hover:bg-danger/10 transition opacity-0 group-hover:opacity-100"
                      title="Remove slot"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-md border border-dashed border-slate-700 bg-slate-900/30 p-3 space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
          Add slot
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-2 items-start">
          <input
            className={`${inputCls} font-mono text-sm`}
            placeholder="SLOT_NAME"
            value={draft.name}
            onChange={e => { setDraft({ ...draft, name: e.target.value }); setError(null); }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          />
          <input
            className={inputCls}
            placeholder="What this secret is used for"
            value={draft.description}
            onChange={e => { setDraft({ ...draft, description: e.target.value }); setError(null); }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          />
          <button
            type="button"
            onClick={add}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-500/90 hover:bg-indigo-400 px-3 py-2 text-sm font-medium text-white transition whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
        {error && (
          <div className="flex items-center gap-1 text-xs text-danger">
            <AlertTriangle className="w-3.5 h-3.5" /> {error}
          </div>
        )}
        {!error && (draft.name || draft.description) && (
          <button
            type="button"
            className={btnGhost}
            onClick={() => { setDraft({ name: "", description: "" }); setError(null); }}
          >
            Clear
          </button>
        )}
      </div>

      {value.length === 0 && (
        <p className="text-xs text-slate-500 italic">
          No secrets yet. Add a slot above if this step needs credentials at runtime.
        </p>
      )}
    </div>
  );
}
