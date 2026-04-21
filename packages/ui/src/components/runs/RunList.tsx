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
  { label: 'All',       value: 'all'       },
  { label: 'Running',   value: 'running'   },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed',    value: 'failed'    },
  { label: 'Blocked',   value: 'blocked'   },
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

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> New Run
        </button>

        <div className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-white p-0.5">
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === opt.value
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search ticket or session…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="w-full rounded-md border border-slate-200 bg-white pl-8 pr-8 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); setSearch(''); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {isFetching && !isLoading && (
          <span className="text-xs text-slate-400">Refreshing…</span>
        )}
      </div>

      {/* Run list */}
      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading…</div>
      ) : error ? (
        <EmptyState title="Connection error" description="Unable to fetch runs. Check your API URL and token.">
          <button onClick={() => { setStatusFilter('all'); setSearchInput(''); setSearch(''); }}
            className="text-sm text-blue-600 hover:underline">Clear filters</button>
        </EmptyState>
      ) : runs.length === 0 ? (
        <EmptyState title="No runs found" description="Try adjusting your filters or start a new run.">
          <button onClick={() => { setStatusFilter('all'); setSearchInput(''); setSearch(''); }}
            className="text-sm text-blue-600 hover:underline">Clear filters</button>
        </EmptyState>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          {runs.map(run => (
            <RunCard key={run.sessionId} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}
