import { useMemo, useRef, useState } from "react";
import type { CustomPhaseInputField, SecretSlotDef } from "@journeyman/core";
import { Maximize2, Minimize2, Variable, KeyRound, AlertTriangle } from "lucide-react";

/**
 * Prompt editor — plain textarea with comfortable sizing, a clickable sidebar
 * for tokens, and a fullscreen toggle. A header bar shows reference counts and
 * any tokens that don't match a declared input/slot.
 */
export interface PromptEditorProps {
  value: string;
  onChange: (next: string) => void;
  inputFields: CustomPhaseInputField[];
  slots: SecretSlotDef[];
}

const INPUT_TOKEN = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const SLOT_TOKEN = /(^|[^A-Z0-9_])\$([A-Z][A-Z0-9_]*)/g;

function analyzeReferences(
  text: string,
  inputNames: Set<string>,
  slotNames: Set<string>,
): { inputs: Set<string>; slots: Set<string>; unknownInputs: string[]; unknownSlots: string[] } {
  const usedInputs = new Set<string>();
  const usedSlots = new Set<string>();
  const unknownInputs: string[] = [];
  const unknownSlots: string[] = [];

  for (const m of text.matchAll(INPUT_TOKEN)) {
    const name = m[1];
    usedInputs.add(name);
    if (!inputNames.has(name) && !unknownInputs.includes(name)) unknownInputs.push(name);
  }
  for (const m of text.matchAll(SLOT_TOKEN)) {
    const name = m[2];
    usedSlots.add(name);
    if (!slotNames.has(name) && !unknownSlots.includes(name)) unknownSlots.push(name);
  }
  return { inputs: usedInputs, slots: usedSlots, unknownInputs, unknownSlots };
}

export function PromptEditor({ value, onChange, inputFields, slots }: PromptEditorProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const inputNames = useMemo(() => new Set(inputFields.map(f => f.name)), [inputFields]);
  const slotNames = useMemo(() => new Set(slots.map(s => s.name)), [slots]);
  const refs = useMemo(
    () => analyzeReferences(value, inputNames, slotNames),
    [value, inputNames, slotNames],
  );

  function insertAtCursor(snippet: string) {
    const ta = taRef.current;
    if (!ta) { onChange(value + snippet); return; }
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + snippet.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  const wrapperCls = fullscreen
    ? "fixed inset-4 z-[70] bg-slate-950 border border-slate-700 rounded-xl shadow-2xl flex flex-col"
    : "flex flex-col rounded-md border border-slate-700 bg-slate-900/50 overflow-hidden";

  return (
    <>
      {fullscreen && <div className="fixed inset-0 z-[65] bg-black/70" />}
      <div className={wrapperCls}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900/70">
          <div className="text-[11px] uppercase tracking-wide text-slate-400 flex items-center gap-2">
            <span>Prompt template</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-500 normal-case tracking-normal">
              Use <code className="text-emerald-300">{"{{input}}"}</code> for inputs and{" "}
              <code className="text-indigo-300">$SLOT</code> for env secrets
            </span>
          </div>
          <button
            type="button"
            onClick={() => setFullscreen(f => !f)}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-800/60 transition"
            title={fullscreen ? "Exit fullscreen" : "Expand to fullscreen"}
          >
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            {fullscreen ? "Exit" : "Expand"}
          </button>
        </div>

        {/* Body */}
        <div className={`grid ${fullscreen ? "flex-1 min-h-0" : "h-[460px]"} grid-cols-1 lg:grid-cols-[1fr_220px]`}>
          {/* Editor */}
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            className="bg-slate-950 text-slate-100 caret-indigo-300 resize-none font-mono text-[13px] leading-[1.55] p-3 outline-none focus:ring-0 selection:bg-indigo-500/40 placeholder:text-slate-600 overflow-auto"
            placeholder="Write your prompt. Reference inputs with {{name}} and env secrets with $SLOT_NAME."
          />

          {/* Sidebar */}
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
                    const used = refs.inputs.has(f.name);
                    return (
                      <li key={f.name}>
                        <button
                          type="button"
                          onClick={() => insertAtCursor(`{{${f.name}}}`)}
                          className={
                            "w-full text-left font-mono rounded px-2 py-1 transition flex items-center gap-2 " +
                            (used
                              ? "text-emerald-300 bg-emerald-950/30 hover:bg-emerald-950/50"
                              : "text-slate-400 hover:text-emerald-300 hover:bg-slate-800/60")
                          }
                          title={f.description || `${f.type}${f.required ? " · required" : ""}`}
                        >
                          <span className="truncate">{`{{${f.name}}}`}</span>
                          {used && <span className="ml-auto text-[10px] text-emerald-400">used</span>}
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
                    const used = refs.slots.has(s.name);
                    return (
                      <li key={s.name}>
                        <button
                          type="button"
                          onClick={() => insertAtCursor(`$${s.name}`)}
                          className={
                            "w-full text-left font-mono rounded px-2 py-1 transition flex items-center gap-2 " +
                            (used
                              ? "text-indigo-300 bg-indigo-950/30 hover:bg-indigo-950/50"
                              : "text-slate-400 hover:text-indigo-300 hover:bg-slate-800/60")
                          }
                          title={s.description}
                        >
                          <span className="truncate">${s.name}</span>
                          {used && <span className="ml-auto text-[10px] text-indigo-400">used</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </aside>
        </div>

        {/* Footer — reference summary / unknowns */}
        {(refs.unknownInputs.length > 0 || refs.unknownSlots.length > 0) && (
          <div className="flex items-start gap-2 border-t border-slate-800 bg-amber-950/20 text-amber-200 text-xs px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              {refs.unknownInputs.length > 0 && (
                <div>
                  Unknown input token(s):{" "}
                  {refs.unknownInputs.map((n, i) => (
                    <span key={n}>
                      {i > 0 && ", "}
                      <code className="text-amber-300">{`{{${n}}}`}</code>
                    </span>
                  ))}{" "}
                  — declare them in the Inputs tab or fix the spelling.
                </div>
              )}
              {refs.unknownSlots.length > 0 && (
                <div>
                  Unknown env token(s):{" "}
                  {refs.unknownSlots.map((n, i) => (
                    <span key={n}>
                      {i > 0 && ", "}
                      <code className="text-amber-300">${n}</code>
                    </span>
                  ))}{" "}
                  — declare them in the Secrets tab if you want them injected.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
