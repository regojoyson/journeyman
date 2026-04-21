import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useRefreshStore } from '@/stores/useRefreshStore';
import { useHealth } from '@/api/runs';
import { RUNS_QUERY_KEY } from '@/api/runs';

export default function TopBar() {
  const { interval, onChange } = useRefreshStore();
  const queryClient = useQueryClient();
  const { isFetching, error, data } = useHealth(interval);

  const isConnected = !error && !!data;

  function handleRefresh() {
    queryClient.refetchQueries({ queryKey: RUNS_QUERY_KEY });
  }

  return (
    <header className="flex h-12 w-full items-center justify-end gap-3 border-b border-slate-100 bg-white px-5">
      {/* Connection status */}
      <span className={`flex items-center gap-1.5 text-xs ${error ? 'text-rose-500' : isConnected ? 'text-emerald-500' : 'text-amber-500'}`}>
        {error ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{error ? 'Disconnected' : isConnected ? 'Connected' : 'Connecting…'}</span>
      </span>

      <div className="h-4 w-px bg-slate-200" />

      {/* Refresh interval */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-400">Every</span>
        <select
          value={interval}
          onChange={e => onChange(Number(e.target.value) as any)}
          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-600 focus:border-blue-500 focus:outline-none"
          aria-label="Refresh interval"
        >
          <option value={5}>5s</option>
          <option value={10}>10s</option>
          <option value={30}>30s</option>
        </select>
      </div>

      {/* Manual refresh */}
      <button
        onClick={handleRefresh}
        className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        title="Refresh now"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
        <span className="hidden sm:inline">Refresh</span>
      </button>
    </header>
  );
}
