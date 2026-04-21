import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useRuns } from '@/api/runs';
import { useProductStore } from '@/stores/useProductStore';
import { Activity, LayoutDashboard } from 'lucide-react';

export default function Sidebar() {
  const { selected } = useProductStore();
  // Use the runs list to derive unique product IDs — no dedicated products endpoint needed.
  const { data, isLoading } = useRuns({ limit: 200 }, 30);

  const products = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    for (const r of data.runs) if (r.productId) seen.add(r.productId);
    return [...seen].sort();
  }, [data]);

  const items = [{ id: 'all', name: 'All Products' }, ...products.map(id => ({ id, name: id }))];

  return (
    <aside className="flex w-[220px] flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <Activity className="h-5 w-5 text-blue-500" />
        <span className="font-semibold text-slate-900">Run Visualizer</span>
      </div>

      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2">
        <LayoutDashboard className="h-4 w-4 text-slate-400" />
        <span className="text-xs font-medium text-slate-500 uppercase">Product</span>
      </div>

      <nav className="flex-1 overflow-auto">
        <ul className="py-1">
          {items.map(p => (
            <li key={p.id}>
              <Link
                to={`/?product=${p.id}`}
                className={`flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50 ${
                  (selected ?? 'all') === p.id ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
                }`}
              >
                <span className="truncate">{p.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-400">
        {isLoading ? 'Loading…' : `${products.length} product${products.length !== 1 ? 's' : ''}`}
      </div>
    </aside>
  );
}
