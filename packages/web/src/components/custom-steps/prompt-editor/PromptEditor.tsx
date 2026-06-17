import { useMemo, useRef, useState } from "react";
import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";
import { Maximize2, Minimize2, AlertTriangle, Pencil, Eye } from "lucide-react";
import { analyzeReferences, namesOf } from "./prompt-tokens.ts";
import { PromptCodeMirror, type PromptCodeMirrorHandle } from "./PromptCodeMirror.tsx";
import { PromptPreview } from "./PromptPreview.tsx";
import { PromptToolbar } from "./PromptToolbar.tsx";
import { TokenSidebar } from "./TokenSidebar.tsx";

export interface PromptEditorProps {
  value: string;
  onChange: (next: string) => void;
  inputFields: CustomStepInputField[];
  slots: SecretSlotDef[];
}

type Mode = "edit" | "preview";

export function PromptEditor({ value, onChange, inputFields, slots }: PromptEditorProps) {
  const cmRef = useRef<PromptCodeMirrorHandle | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [mode, setMode] = useState<Mode>("edit");

  const refs = useMemo(
    () => analyzeReferences(value, namesOf(inputFields), namesOf(slots)),
    [value, inputFields, slots],
  );

  const wrapperCls = fullscreen
    ? "fixed inset-4 z-[70] bg-bg border border-slate-700 rounded-xl shadow-2xl flex flex-col"
    : "flex flex-col rounded-md border border-slate-700 bg-slate-900/50 overflow-hidden";

  const tabBtn = (active: boolean) =>
    "inline-flex items-center gap-1 px-2.5 py-1 transition " +
    (active ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200");

  return (
    <>
      {fullscreen && <div className="fixed inset-0 z-[65] bg-overlay" />}
      <div className={wrapperCls}>
        {/* Header: Edit/Preview toggle + fullscreen */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 bg-slate-900/70">
          <div className="inline-flex rounded-md border border-slate-700 overflow-hidden text-xs">
            <button type="button" onClick={() => setMode("edit")} className={tabBtn(mode === "edit")}>
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
            <button
              type="button"
              onClick={() => setMode("preview")}
              className={"border-l border-slate-700 " + tabBtn(mode === "preview")}
            >
              <Eye className="w-3.5 h-3.5" /> Preview
            </button>
          </div>
          <button
            type="button"
            onClick={() => setFullscreen(f => !f)}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded hover:bg-surface-hover transition"
            title={fullscreen ? "Exit fullscreen" : "Expand to fullscreen"}
          >
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            {fullscreen ? "Exit" : "Expand"}
          </button>
        </div>

        {/* Formatting toolbar (edit mode only) */}
        {mode === "edit" && (
          <PromptToolbar onCommand={build => cmRef.current?.applyCommand(build)} />
        )}

        {/* Body */}
        <div
          className={
            `grid ${fullscreen ? "flex-1 min-h-0" : "h-[460px]"} ` +
            (mode === "edit" ? "grid-cols-1 lg:grid-cols-[1fr_220px]" : "grid-cols-1")
          }
        >
          <div className="min-w-0 overflow-auto bg-bg">
            {mode === "edit" ? (
              <PromptCodeMirror
                ref={cmRef}
                value={value}
                onChange={onChange}
                inputFields={inputFields}
                slots={slots}
                height={fullscreen ? "100%" : "460px"}
              />
            ) : (
              <PromptPreview value={value} inputFields={inputFields} slots={slots} />
            )}
          </div>

          {mode === "edit" && (
            <TokenSidebar
              inputFields={inputFields}
              slots={slots}
              used={refs}
              onInsert={snippet => cmRef.current?.insertAtCursor(snippet)}
            />
          )}
        </div>

        {/* Footer: unknown-token summary */}
        {(refs.unknownInputs.length > 0 || refs.unknownSlots.length > 0) && (
          <div className="flex items-start gap-2 border-t border-slate-700 bg-warning/10 text-warning text-xs px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              {refs.unknownInputs.length > 0 && (
                <div>
                  Unknown input token(s):{" "}
                  {refs.unknownInputs.map((n, i) => (
                    <span key={n}>
                      {i > 0 && ", "}
                      <code className="text-warning font-semibold">{`{{${n}}}`}</code>
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
                      <code className="text-warning font-semibold">${n}</code>
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
