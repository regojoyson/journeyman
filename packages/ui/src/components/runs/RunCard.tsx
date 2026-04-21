import { Link } from 'react-router-dom';
import { RunListItem, RunStep } from '@/types/api.types';
import { relativeTime } from '@/utils/format';
import { CheckCircle2, XCircle, Loader2, PauseCircle, Ban, Circle } from 'lucide-react';

interface RunCardProps { run: RunListItem; steps?: RunStep[]; }

const STATUS_META: Record<string, { icon: React.ReactNode; bar: string; label: string }> = {
  running:   { icon: <Loader2  className="h-3.5 w-3.5 animate-spin text-blue-500" />,   bar: 'bg-blue-500',    label: 'Running'   },
  completed: { icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,          bar: 'bg-emerald-500', label: 'Completed' },
  failed:    { icon: <XCircle  className="h-3.5 w-3.5 text-rose-500" />,                 bar: 'bg-rose-500',    label: 'Failed'    },
  blocked:   { icon: <PauseCircle className="h-3.5 w-3.5 text-amber-500" />,             bar: 'bg-amber-500',   label: 'Blocked'   },
  cancelled: { icon: <Ban      className="h-3.5 w-3.5 text-slate-400" />,                bar: 'bg-slate-300',   label: 'Cancelled' },
};

export default function RunCard({ run, steps }: RunCardProps) {
  const completedSteps = steps?.filter(s => s.status === 'ok').length ?? 0;
  const totalSteps = steps?.length ?? 0;
  const meta = STATUS_META[run.status] ?? { icon: <Circle className="h-3.5 w-3.5 text-slate-400" />, bar: 'bg-slate-300', label: run.status };
  const pct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : null;

  return (
    <Link
      to={`/run/${run.sessionId}`}
      className="group flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
    >
      {/* Status icon */}
      <div className="flex-shrink-0">{meta.icon}</div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm font-medium text-slate-900 truncate">{run.ticketKey}</span>
          {run.title && (
            <span className="text-xs text-slate-400 truncate hidden sm:block">{run.title}</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-slate-400">{run.productId}</span>
          {run.flowName && (
            <><span className="text-slate-200">·</span><span className="text-xs text-slate-400">{run.flowName}</span></>
          )}
        </div>
      </div>

      {/* Right: steps + time */}
      <div className="flex-shrink-0 text-right space-y-0.5">
        {pct !== null && (
          <div className="flex items-center justify-end gap-1.5">
            <div className="w-16 h-1 rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-full rounded-full ${meta.bar} transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-slate-400 w-7 text-right">{pct}%</span>
          </div>
        )}
        <div className="text-xs text-slate-400">{run.createdAt ? relativeTime(run.createdAt) : '—'}</div>
      </div>
    </Link>
  );
}
