type StatusTone = "success" | "warning";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success/10 text-success border-emerald-800/60",
  warning: "bg-warning/10 text-warning border-amber-800/60",
};

export function StatusChip({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}
