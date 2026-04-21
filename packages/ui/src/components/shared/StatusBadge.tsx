// packages/ui/src/components/shared/StatusBadge.tsx
import { RunStatus } from '@/types/api.types';

const COLORS: Record<RunStatus, string> = {
  running: 'bg-blue-100 text-blue-700 border-blue-200',
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  failed: 'bg-rose-100 text-rose-700 border-rose-200',
  blocked: 'bg-amber-100 text-amber-700 border-amber-200',
  cancelled: 'bg-slate-100 text-slate-400 border-slate-200',
};

const LABELS: Record<RunStatus, string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};

interface StatusBadgeProps { status: RunStatus; size?: 'sm' | 'md'; }

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border ${COLORS[status]} ${sizeClasses}`}>
      {status === 'running' && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
      {LABELS[status]}
    </span>
  );
}
