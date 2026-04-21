import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRuns, useProducts } from '@/api/runs';
import { Zap } from 'lucide-react';

export default function Sidebar() {
  const [searchParams] = useSearchParams();
  const selected = searchParams.get('product') ?? 'all';
  const { data: configuredProducts, isLoading } = useProducts();
  const { data: runsData } = useRuns({ limit: 200 }, 30);

  const products = useMemo(() => {
    const seen = new Set<string>((configuredProducts ?? []).map(p => p.id));
    for (const r of (runsData?.runs ?? [])) if (r.productId) seen.add(r.productId);
    return [...seen].sort();
  }, [configuredProducts, runsData]);

  const items = [{ id: 'all', name: 'All Products' }, ...products.map(id => ({ id, name: id }))];

  return (
    <aside className="flex w-52 flex-col border-r border-slate-100 bg-white">
      {/* Brand */}
      <div className="flex items-center gap-2 px-4 py-4">
        <Zap className="h-4 w-4 text-blue-500" />
        <span className="text-sm font-semibold text-slate-900">Journeyman</span>
      </div>

      {/* Section label */}
      <div className="px-4 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Products</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-auto px-2">
        {items.map(p => (
          <Link
            key={p.id}
            to={`/?product=${p.id}`}
            className={`flex w-full items-center rounded-md px-3 py-1.5 text-sm transition-colors ${
              selected === p.id
                ? 'bg-blue-50 font-medium text-blue-700'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            {p.name}
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3">
        <span className="text-xs text-slate-400">
          {isLoading ? '…' : `${products.length} product${products.length !== 1 ? 's' : ''}`}
        </span>
      </div>
    </aside>
  );
}
