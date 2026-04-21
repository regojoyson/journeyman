interface ProgressBarProps { value: number; max: number; showPercent?: boolean; }

export default function ProgressBar({ value, max, showPercent }: ProgressBarProps) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      {showPercent && <span className="text-xs text-slate-400 tabular-nums">{pct}%</span>}
    </div>
  );
}
