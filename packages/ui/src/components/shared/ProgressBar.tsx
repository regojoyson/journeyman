// packages/ui/src/components/shared/ProgressBar.tsx
interface ProgressBarProps { value: number; max: number; showPercent?: boolean; }

export default function ProgressBar({ value, max }: ProgressBarProps) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-blue-500 transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
