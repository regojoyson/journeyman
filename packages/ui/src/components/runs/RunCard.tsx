// packages/ui/src/components/runs/RunCard.tsx

import { Link } from 'react-router-dom';
import { RunListItem, RunStep } from '@/types/api.types';
import StatusBadge from '@/components/shared/StatusBadge';
import ProgressBar from '@/components/shared/ProgressBar';

interface RunCardProps { run: RunListItem; steps?: RunStep[]; }

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-blue-100 text-blue-700 border-blue-200',
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  failed: 'bg-rose-100 text-rose-700 border-rose-200',
  blocked: 'bg-amber-100 text-amber-700 border-amber-200',
  pending: 'bg-slate-100 text-slate-500 border-slate-200',
  cancelled: 'bg-slate-100 text-slate-400 border-slate-200',
};

export default function RunCard({ run, steps }: RunCardProps) {
  const completedSteps = steps?.filter(s => s.status === 'completed').length ?? 0;
  const totalSteps = steps?.length ?? 0;
  function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  const relativeUpdated = run.updatedAt ? relativeTime(run.updatedAt) : 'unknown';

  return (
    <Link
      to={`/run/${run.sessionId}`}
      className="group rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md hover:border-slate-300"
    >
      {/* Top row: product + ticket */}
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
          {run.productId}
        </span>
        <span className="text-sm font-medium text-slate-900">{run.ticketKey}</span>
        <span className="text-xs text-slate-400 truncate">{run.title}</span>
      </div>

      {/* Status */}
      <div className="mb-3 flex items-center gap-2">
        <StatusBadge status={run.status} />
        {totalSteps > 0 && (
          <span className="text-xs text-slate-500">{completedSteps}/{totalSteps} steps</span>
        )}
      </div>

      {/* Progress bar */}
      {totalSteps > 0 && (
        <div className="mb-3">
          <ProgressBar value={completedSteps} max={totalSteps} showPercent />
        </div>
      )}

      {/* Mini timeline */}
      {steps && steps.length > 0 && (
        <div className="mb-3 flex items-center gap-1 overflow-x-auto pb-1">
          {steps.map(step => {
            const color = STATUS_COLORS[step.status] || STATUS_COLORS.pending;
            const isRunning = step.status === 'running';
            return (
              <div key={step.stepId} className="flex flex-col items-center" title={`${step.name}: ${step.status}`}>
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full border text-[8px] ${color} ${
                    isRunning ? 'animate-pulse-ring' : ''
                  }`}
                >
                  {step.status === 'completed' ? '✓' : step.status === 'failed' ? '✕' : step.status === 'running' ? '↻' : step.status === 'blocked' ? '⏸' : '○'}
                </div>
                <span className="mt-0.5 text-[8px] text-slate-400">{step.name.slice(0, 6)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Timestamp */}
      <div className="text-xs text-slate-400">{relativeUpdated}</div>
    </Link>
  );
}
