import { useEffect, useRef, useState } from "react";
import {
  CUSTOM_PHASE_ICON_NAMES,
  DEFAULT_CUSTOM_PHASE_ICON_ID,
} from "@journeyman/core";
import { resolvePhaseIcon } from "@journeyman/flow-editor";

export interface IconPickerProps {
  /** Current icon id; `null` means "use default". */
  value: string | null;
  onChange: (next: string | null) => void;
}

/**
 * Compact icon picker: a single tile button that opens a popover with the
 * curated Lucide grid. Keeps the form visually quiet — the icon is a small
 * affordance, not a dominant block.
 */
export function IconPicker({ value, onChange }: IconPickerProps) {
  const selectedId = value ?? DEFAULT_CUSTOM_PHASE_ICON_ID;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={selectedId}
        className="flex items-center gap-2 px-2 py-1 rounded-md bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-100"
      >
        <span className="w-6 h-6 flex items-center justify-center">
          {resolvePhaseIcon(selectedId, { size: 16 })}
        </span>
        <span className="text-xs text-slate-400">Change</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose icon"
          className="absolute z-20 mt-2 left-0 w-[20rem] rounded-md border border-slate-700 bg-slate-900 shadow-xl p-3 space-y-2"
        >
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-slate-400 truncate">
              <code className="text-slate-200">{selectedId}</code>
            </div>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="text-[11px] text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline"
            >
              Reset to default
            </button>
          </div>
          <div
            role="radiogroup"
            aria-label="Phase icon"
            className="grid grid-cols-8 gap-1 max-h-56 overflow-y-auto"
          >
            {CUSTOM_PHASE_ICON_NAMES.map((name) => {
              const id = `lucide:${name}`;
              const isSelected = id === selectedId;
              return (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  title={name}
                  onClick={() => {
                    onChange(id);
                    setOpen(false);
                  }}
                  className={
                    "h-8 w-8 flex items-center justify-center rounded border transition " +
                    (isSelected
                      ? "bg-indigo-500/20 border-indigo-400 text-indigo-100"
                      : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600 hover:text-slate-100")
                  }
                >
                  {resolvePhaseIcon(id, { size: 16 })}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
