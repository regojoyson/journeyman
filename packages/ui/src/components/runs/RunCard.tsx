import { Link } from 'react-router-dom';
import { RunListItem, RunStep } from '@/types/api.types';
import StatusBadge from '@/components/shared/StatusBadge';
import ProgressBar from '@/components/shared/ProgressBar';
import { relativeTime } from '@/utils/format';

interface RunCardProps { run: RunListItem; steps?: RunStep[]; }

const STEP_COLORS: Record<string, string> = {
  running:   'bg-blue-100 text-blue-700 border-blue-200',
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  failed:    'bg-rose-100 text-rose-700 border-rose-200',
  blocked:   'bg-amber-100 text-amber-700 border-amber-200',
  cancelled: 'bg-slate-100 text-slate-400 border-slate-200',
  pending:   'bg-slate-100 text-slate-500 border-slate-200',
};

const STEP_ICONS: Record<string, string> = {
  running: '↻', completed: '✓', failed: '✕', blocked: '⏸', cancelled: '—',
};

export default function RunCard({ run, steps }: RunCardProps) {
  const completedSteps = steps?.filter(s => s.status === 'ok').length ?? 0;
  const totalSteps = steps?.length ?? 0;

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

      {/* Mini step strip */}
      {steps && steps.length > 0 && (
        <div className="mb-3 flex items-center gap-1 overflow-x-auto pb-1">
          {steps.map(step => {
            const uiStatus = step.status === 'ok' ? 'completed' : step.status;
            const color = STEP_COLORS[uiStatus] ?? STEP_COLORS.pending;
            return (
              <div key={step.id} className="flex flex-col items-center" title={`${step.id}: ${step.status}`}>
                <div className={`flex h-5 w-5 items-center justify-center rounded-full border text-[8px] ${color} ${step.status === 'running' ? 'animate-pulse' : ''}`}>
                  {STEP_ICONS[uiStatus] ?? '○'}
                </div>
                <span className="mt-0.5 text-[8px] text-slate-400">{step.id.slice(0, 6)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Timestamp */}
      <div className="text-xs text-slate-400">{run.createdAt ? relativeTime(run.createdAt) : 'unknown'}</div>
    </Link>
  );
}
