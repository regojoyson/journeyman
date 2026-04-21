import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useRuns } from '@/api/runs';
import { useRefreshStore } from '@/stores/useRefreshStore';
import RunCard from './RunCard';
import CreateRunDialog from './CreateRunDialog';
import EmptyState from '@/components/shared/EmptyState';
import { FilterStatus } from '@/types/api.types';
import { X, Search, Plus } from 'lucide-react';

const STATUS_OPTIONS: { label: string; value: FilterStatus }[] = [
  { label: 'All', value: 'all' },
  { label: 'Running', value: 'running' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Blocked', value: 'blocked' },
  { label: 'Cancelled', value: 'cancelled' },
];

export default function RunList() {
  const [searchParams] = useSearchParams();
  const selected = searchParams.get('product') ?? 'all';
  const { interval } = useRefreshStore();
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  // Debounce search: only fire API request 300ms after the user stops typing.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, error, isFetching } = useRuns(
    {
      status: statusFilter === 'all' ? undefined : statusFilter,
      productId: selected && selected !== 'all' ? selected : undefined,
      search: search || undefined,
      limit: 50,
    },
    interval,
  );

  const runs = data?.runs ?? [];

  return (
    <div className="space-y-4">
      <CreateRunDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultProductId={selected !== 'all' ? selected : undefined}
      />

      {/* Filters + New Run */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> New Run
        </button>
        {/* Status pills */}
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
            placeholder="Search ticket key or session ID…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="w-full rounded border border-slate-300 pl-8 pr-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); setSearch(''); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-slate-400">Loading runs…</div>
      ) : error ? (
        <EmptyState title="Connection Error" description="Unable to fetch runs. Check your API URL and token.">
          <button
            onClick={() => { setStatusFilter('all'); setSearchInput(''); setSearch(''); }}
            className="text-sm text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        </EmptyState>
      ) : runs.length === 0 ? (
        <EmptyState title="No runs found" description="Try adjusting your filters or wait for new runs.">
          <button
            onClick={() => { setStatusFilter('all'); setSearchInput(''); setSearch(''); }}
            className="text-sm text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {runs.map(run => (
            <RunCard key={run.sessionId} run={run} />
          ))}
        </div>
      )}

      {isFetching && !isLoading && (
        <div className="text-xs text-slate-400">Refreshing…</div>
      )}
    </div>
  );
}
