import type { ReactNode } from "react";

/** Standard on/off switch. Wraps a visually-hidden checkbox so it stays accessible and form-friendly. */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm select-none cursor-pointer aria-disabled:cursor-not-allowed" aria-disabled={disabled}>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="h-5 w-9 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4 peer-disabled:opacity-70" />{/* theme-colors-allow: knob stays white for contrast on the colored track in both themes */}
      </span>
      {label}
    </label>
  );
}
