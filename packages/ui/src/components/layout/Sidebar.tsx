// packages/ui/src/components/layout/Sidebar.tsx
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useProviders } from '@/api/runs';
import { useProductStore } from '@/stores/useProductStore';
import { Activity, LayoutDashboard } from 'lucide-react';

export default function Sidebar() {
  const { selected } = useProductStore();
  const { data: providers, isLoading } = useProviders();
  const products = useMemo(() => {
    if (!providers) return [];
    // Flatten providers into product-like options for the combobox
    return providers.flatMap(p =>
      p.providers.map(pv => ({ id: pv, name: `${p.name}: ${pv}` }))
    );
  }, [providers]);

  // Fallback hardcoded list if API not reachable
  const fallbackProducts = [
    { id: 'all', name: 'All Products' },
    { id: 'journeyman-core', name: 'journeyman-core' },
    { id: 'journeyman-coding-cli', name: 'journeyman-coding-cli' },
    { id: 'journeyman-git-provider', name: 'journeyman-git-provider' },
  ];

  const displayProducts = products.length > 0 ? [{ id: 'all', name: 'All Products' }, ...products] : fallbackProducts;

  return (
    <aside className="flex w-[260px] flex-col border-r border-slate-200 bg-white">
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
          {displayProducts.map(p => (
            <li key={p.id}>
              <Link
                to={`/?product=${p.id}`}
                className={`flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50 ${
                  selected === p.id ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
                }`}
              >
                <span className="truncate">{p.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-400">
        {isLoading ? 'Loading...' : `${displayProducts.length} products`}
      </div>
    </aside>
  );
}
