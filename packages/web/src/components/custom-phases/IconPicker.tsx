import {
  CUSTOM_PHASE_ICON_NAMES,
  DEFAULT_CUSTOM_PHASE_ICON_ID,
} from "@journeyman/core";
import { resolvePhaseIcon } from "@journeyman/flow-editor";

export interface IconPickerProps {
  /** Current icon id; `null` means "use default" and the default tile is highlighted. */
  value: string | null;
  onChange: (next: string | null) => void;
}

/**
 * Flat grid of curated Lucide icons. Clicking a tile sets `lucide:<Name>`.
 * "Reset to default" sends `null`, which resolves to DEFAULT_CUSTOM_PHASE_ICON_ID
 * at render time.
 */
export function IconPicker({ value, onChange }: IconPickerProps) {
  const selectedId = value ?? DEFAULT_CUSTOM_PHASE_ICON_ID;
  const defaultName = DEFAULT_CUSTOM_PHASE_ICON_ID.replace(/^lucide:/, "");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-100">
          {resolvePhaseIcon(selectedId, { size: 20 })}
        </div>
        <div className="text-xs text-slate-400">
          Current: <code className="text-slate-200">{selectedId}</code>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-auto text-xs text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline"
        >
          Reset to default
        </button>
      </div>
      <div
        role="radiogroup"
        aria-label="Phase icon"
        className="grid grid-cols-8 gap-2"
      >
        {CUSTOM_PHASE_ICON_NAMES.map((name) => {
          const id = `lucide:${name}`;
          const isSelected = id === selectedId;
          const isDefault = name === defaultName && value === null;
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={isSelected}
              title={name}
              onClick={() => onChange(id)}
              className={
                "h-9 w-9 flex items-center justify-center rounded-md border transition " +
                (isSelected
                  ? "bg-indigo-500/20 border-indigo-400 text-indigo-100"
                  : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600 hover:text-slate-100") +
                (isDefault && !isSelected ? " ring-1 ring-slate-700" : "")
              }
            >
              {resolvePhaseIcon(id, { size: 18 })}
            </button>
          );
        })}
      </div>
      {/* TODO(custom-phase-icon-uploads):
          When uploads ship, render a file-input + preview below this grid.
          The resolver already supports data:image/... values, so storage and
          rendering are wired — only this picker needs the new affordance. */}
    </div>
  );
}
