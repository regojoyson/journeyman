import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";
import { Variable, KeyRound } from "lucide-react";
import type { ReferenceAnalysis } from "./prompt-tokens.ts";

export function TokenSidebar({
  inputFields,
  slots,
  used,
  onInsert,
}: {
  inputFields: CustomStepInputField[];
  slots: SecretSlotDef[];
  used: ReferenceAnalysis;
  onInsert: (snippet: string) => void;
}) {
  return (
    <aside className="border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900/40 overflow-y-auto p-3 text-xs space-y-4">
      <section>
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400 mb-2">
          <Variable className="w-3.5 h-3.5 text-emerald-400" />
          <span>Inputs</span>
          {inputFields.length > 0 && (
            <span className="ml-auto text-[10px] text-slate-500">click to insert</span>
          )}
        </div>
        {inputFields.length === 0 ? (
          <div className="text-slate-500 italic">No inputs declared</div>
        ) : (
          <ul className="space-y-1">
            {inputFields.map(f => {
              const isUsed = used.inputs.has(f.name);
              return (
                <li key={f.name}>
                  <button
                    type="button"
                    onClick={() => onInsert(`{{${f.name}}}`)}
                    className={
                      "w-full text-left font-mono rounded px-2 py-1 transition flex items-center gap-2 " +
                      (isUsed
                        ? "text-emerald-300 bg-emerald-950/30 hover:bg-emerald-950/50"
                        : "text-slate-400 hover:text-emerald-300 hover:bg-slate-800/60")
                    }
                    title={f.description || `${f.type}${f.required ? " · required" : ""}`}
                  >
                    <span className="truncate">{`{{${f.name}}}`}</span>
                    {isUsed && <span className="ml-auto text-[10px] text-emerald-400">used</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400 mb-2">
          <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
          <span>Env in $bash</span>
          {slots.length > 0 && (
            <span className="ml-auto text-[10px] text-slate-500">click to insert</span>
          )}
        </div>
        {slots.length === 0 ? (
          <div className="text-slate-500 italic">No slots declared</div>
        ) : (
          <ul className="space-y-1">
            {slots.map(s => {
              const isUsed = used.slots.has(s.name);
              return (
                <li key={s.name}>
                  <button
                    type="button"
                    onClick={() => onInsert(`$${s.name}`)}
                    className={
                      "w-full text-left font-mono rounded px-2 py-1 transition flex items-center gap-2 " +
                      (isUsed
                        ? "text-indigo-300 bg-indigo-950/30 hover:bg-indigo-950/50"
                        : "text-slate-400 hover:text-indigo-300 hover:bg-slate-800/60")
                    }
                    title={s.description}
                  >
                    <span className="truncate">${s.name}</span>
                    {isUsed && <span className="ml-auto text-[10px] text-indigo-400">used</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
}
