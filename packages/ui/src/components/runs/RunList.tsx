// packages/ui/src/components/runs/RunList.tsx

import { useState } from 'react';
import { useRuns } from '@/api/runs';
import { useProductStore } from '@/stores/useProductStore';
import { useRefreshStore } from '@/stores/useRefreshStore';
import RunCard from './RunCard';
import EmptyState from '@/components/shared/EmptyState';
import { FilterStatus } from '@/types/api.types';
import { X, Search } from 'lucide-react';

const STATUS_OPTIONS: { label: string; value: FilterStatus }[] = [
  { label: 'All', value: 'all' },
  { label: 'Running', value: 'running' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Blocked', value: 'blocked' },
  { label: 'Cancelled', value: 'cancelled' },
];

export default function RunList() {
  const { selected } = useProductStore();
  const { interval } = useRefreshStore();
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading, error, isFetching } = useRuns(
    {
      status: statusFilter === 'all' ? undefined : statusFilter,
      productId: selected === 'all' ? undefined : selected ?? undefined,
      search,
      limit: 50,
    },
    interval
  );

  const runs = data?.runs ?? [];

  // Responsive grid cols based on screen width
  const gridCols = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status filter */}
        <div className="flex items-center gap-1">
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`rounded px-2 py-1 text-xs font-medium transition ${
                statusFilter === opt.value
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search ticket key or session ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded border border-slate-300 pl-8 pr-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Loading or runs */}
      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-slate-400">Loading runs...</div>
      ) : error ? (
        <EmptyState title="Connection Error" description="Unable to fetch runs. Check your API URL and token.">
          <div className="text-xs text-rose-500">{error.message}</div>
        </EmptyState>
      ) : runs.length === 0 ? (
        <EmptyState title="No runs found" description="Try adjusting your filters or wait for new runs.">
          <button
            onClick={() => { setStatusFilter('all'); setSearch(''); }}
            className="text-sm text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        </EmptyState>
      ) : (
        <div className={gridCols}>
          {runs.map(run => (
            <RunCard key={run.sessionId} run={run} />
          ))}
        </div>
      )}

      {isFetching && <div className="text-xs text-slate-400">Refreshing...</div>}
    </div>
  );
}
