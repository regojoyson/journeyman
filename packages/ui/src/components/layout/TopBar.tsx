// packages/ui/src/components/layout/TopBar.tsx
import { useState } from 'react';
import { RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useRefreshStore } from '@/stores/useRefreshStore';
import { useRuns } from '@/api/runs';

export default function TopBar() {
  const { interval, onChange } = useRefreshStore();
  const { isFetching, error } = useRuns({ status: 'all', limit: 50 }, interval);
  const [refreshing, setRefreshing] = useState(false);

  const isConnected = !error && !isFetching;
  const statusColor = error ? 'text-rose-500' : isConnected ? 'text-emerald-500' : 'text-amber-500';
  const statusIcon = error ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />;

  return (
    <header className="flex h-[56px] w-full items-center justify-between border-b border-slate-200 bg-white px-6">
      <div className="flex items-center gap-3">
        <span className={`flex items-center gap-1.5 text-sm ${statusColor}`}>
          {statusIcon}
          <span className="hidden sm:inline">{error ? 'Connection lost' : 'Connected'}</span>
        </span>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-xs text-slate-500">Refresh every</span>
        <select
          value={interval}
          onChange={e => onChange(Number(e.target.value) as any)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        >
          <option value={5}>5s</option>
          <option value={10}>10s</option>
          <option value={30}>30s</option>
        </select>
        <button
          className="flex items-center gap-1 rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
          onClick={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 1000); }}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>
    </header>
  );
}
