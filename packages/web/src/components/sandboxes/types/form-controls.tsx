import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { codePill } from "../../../routes/admin-styles.ts";

/** Inline code/example chip. */
export function Code({ children }: { children: ReactNode }) {
  return <code className={codePill}>{children}</code>;
}

/** Labeled field: icon + label on top, control, then a muted hint line. */
export function Field({ icon: Icon, label, hint, children }: {
  icon: LucideIcon; label: string; hint?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-200">
        <Icon size={14} className="text-accent shrink-0" aria-hidden />
        {label}
      </div>
      {children}
      {hint && <p className="text-xs leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}

/** Checkbox row with an icon, label, and hint underneath. */
export function CheckField({ icon: Icon, label, hint, checked, onChange }: {
  icon: LucideIcon; label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <Icon size={14} className="text-accent shrink-0" aria-hidden />
        {label}
      </label>
      {hint && <p className="ml-6 text-xs leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}
