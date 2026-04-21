# Run Visualizer UI Implementation Plan

> **For agnostic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/ui/` — a Vite + React + TypeScript SPA that visualizes Journeyman pipeline runs with a product selector sidebar, run card grid, and horizontal step timeline detail view.

**Architecture:** Standalone Vite SPA in the monorepo consuming the existing Management REST API (`/api/runs`, `/api/runs/:sessionId`, `/api/flows`, `/api/providers`, `/api/runs/:sessionId/logs`, etc.). TanStack Query handles polling (10s list, 5s running) and caching. Radix UI primitives + Tailwind for unstyled, accessible components. A horizontal step timeline renders the pipeline flow.

**Tech Stack:** Vite 5, React 18, TypeScript (strict), React Router 7, TanStack Query 5, Tailwind CSS 3, Radix UI, Lucide React, Framer Motion

**Spec:** [docs/superpowers/specs/2026-04-20-run-visualizer-ui-design.md](../specs/2026-04-20-run-visualizer-ui-design.md)

---

## Scope Check

The spec covers one cohesive subsystem: a single-SPA run visualizer UI. No need to split further.

## Execution strategy

Tasks are grouped into **waves**. Waves must run in order.

- **Wave 0**: scaffold — Vite project, monorepo wiring, TypeScript, Tailwind
- **Wave 1**: types + API client — type definitions, fetch wrapper, env config
- **Wave 2**: layout shell — AppShell, Sidebar with product combobox, TopBar
- **Wave 3**: run list — API hooks, RunList grid, RunCard with mini-timeline, filters
- **Wave 4**: run detail — RunDetail page, StepTimeline horizontal diagram, step click panel
- **Wave 5**: polish — StatusBadge, ProgressBar, EmptyState, LogPanel, animations, error states
- **Wave 6 (FINAL)**: `npm run typecheck` + visual smoke test in browser + **single commit**

---

## File Structure

### New files

| File | Purpose |
|---|---|
| `packages/ui/package.json` | Dependencies (React, Vite, Radix, TanStack, etc.) |
| `packages/ui/vite.config.ts` | Vite + React + alias config |
| `packages/ui/tsconfig.json` | TypeScript (strict), `@/*` alias |
| `packages/ui/index.html` | SPA entry HTML |
| `packages/ui/.env.example` | `VITE_API_URL` + `VITE_API_TOKEN` |
| `packages/ui/src/main.tsx` | React root render |
| `packages/ui/src/vite-env.d.ts` | Vite env type declarations |
| `packages/ui/src/types/api.types.ts` | Manual types mirroring API |
| `packages/ui/src/api/client.ts` | Fetch wrapper with auth headers |
| `packages/ui/src/api/runs.ts` | TanStack Query hooks (useRuns, useRunDetail, useLogs, useProviders, useFlows) |
| `packages/ui/src/stores/useProductStore.ts` | LocalStorage-backed selected product selector |
| `packages/ui/src/stores/useRefreshStore.ts` | LocalStorage-backed polling interval |
| `packages/ui/src/styles/globals.css` | Tailwind imports + custom classes |
| `packages/ui/src/App.tsx` | Router + providers (QueryClient, QueryClientProvider) |
| `packages/ui/src/components/layout/AppShell.tsx` | Full app frame (sidebar + main) |
| `packages/ui/src/components/layout/Sidebar.tsx` | Product combobox + nav links |
| `packages/ui/src/components/layout/TopBar.tsx` | Page title, refresh selector, connection status |
| `packages/ui/src/components/runs/RunList.tsx` | Card grid, filters bar |
| `packages/ui/src/components/runs/RunCard.tsx` | Single run card with mini-timeline |
| `packages/ui/src/components/runs/RunDetail.tsx` | Detail page with timeline + step panels |
| `packages/ui/src/components/runs/StepTimeline.tsx` | Horizontal step flow diagram |
| `packages/ui/src/components/shared/StatusBadge.tsx` | Color-coded status pill |
| `packages/ui/src/components/shared/ProgressBar.tsx` | Horizontal progress bar |
| `packages/ui/src/components/shared/LogPanel.tsx` | Collapsible scrollable log viewer |
| `packages/ui/src/components/shared/EmptyState.tsx` | No runs / no product empty state |
| `packages/ui/public/favicon.svg` | Simple icon |

### No modified files

This is a greenfield package. The root `package.json` workspaces array will be updated to include `"packages/ui"`.

---

## Wave 0 — Scaffold

### Task 0.1: Scaffold packages/ui/

- [ ] **Step 1: Add ui to root workspaces and create package.json**

Add `"packages/ui"` to the `workspaces` array in root `package.json`, then create:

```jsonc
// packages/ui/package.json
{
  "name": "@journeyman/ui",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@headlessui/react": "^2.1.0",
    "@radix-ui/react-combobox": "^1.1.0",
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-dropdown-menu": "^2.1.0",
    "@radix-ui/react-separator": "^1.1.0",
    "@radix-ui/react-tabs": "^1.1.0",
    "@radix-ui/react-tooltip": "^1.1.0",
    "@tanstack/react-query": "^5.50.0",
    "framer-motion": "^11.0.0",
    "lucide-react": "^0.400.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create vite.config.ts**

```typescript
// packages/ui/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 3: Create tsconfig.json**

```jsonc
// packages/ui/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Run Visualizer — Journeyman</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create .env.example**

```env
# Base URL of the Management API
VITE_API_URL=http://localhost:3000

# Optional: API token for authentication
VITE_API_TOKEN=your-token-here
```

- [ ] **Step 6: Create public/favicon.svg**

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="45" fill="#3b82f6" />
  <text x="50" y="62" font-size="40" text-anchor="middle" fill="white" font-family="monospace">rv</text>
</svg>
```

- [ ] **Step 7: Run `npm install` at root to add the new package**

Run: `cd /Users/sam-rego/data/workspace/journeyman && npm install`

---

## Wave 1: Types + API Client

### Task 1.1: Core types and API client

**Files:**
- Create: `packages/ui/src/types/api.types.ts`
- Create: `packages/ui/src/api/client.ts`
- Create: `packages/ui/src/api/runs.ts`
- Create: `packages/ui/src/vite-env.d.ts`
- Create: `packages/ui/src/stores/useProductStore.ts`
- Create: `packages/ui/src/stores/useRefreshStore.ts`

- [ ] **Step 1: Write api.types.ts**

```typescript
// packages/ui/src/types/api.types.ts

export type RunStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';

export interface RunListItem {
  sessionId: string;
  productId: string;
  flowName: string;
  ticketKey: string;
  title: string;
  status: RunStatus;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface RunStep {
  stepId: string;
  name: string;
  status: RunStatus;
  startedAt: string | null;
  endedAt: string | null;
  duration: number | null;   // seconds
  logLines: number;
  outputs?: Record<string, unknown>;
}

export interface ArtifactMeta {
  key: string;
  name: string;
  size: number;
  createdAt: string;
}

export interface RunDetail extends RunListItem {
  steps: RunStep[];
  artifacts: ArtifactMeta[];
}

export interface LogLine {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  source: string;
}

export interface ProductOption {
  id: string;
  name: string;
}

export interface FlowDefinition {
  name: string;
  phases: string[];
}

export interface ProviderCategory {
  name: string;
  providers: string[];
}

export interface RunListResponse {
  runs: RunListItem[];
  total: number;
}

export type FilterStatus = RunStatus | 'all';
```

- [ ] **Step 2: Write api/client.ts**

```typescript
// packages/ui/src/api/client.ts

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const TOKEN = import.meta.env.VITE_API_TOKEN;

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (TOKEN) h['Authorization'] = `Bearer ${TOKEN}`;
  return h;
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${res.statusText} — ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function getRuns(params?: { limit?: number; offset?: number; status?: string; productId?: string; search?: string }): Promise<RunListResponse> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  if (params?.status) qs.set('status', params.status);
  if (params?.productId) qs.set('productId', params.productId);
  if (params?.search) qs.set('search', params.search);
  const url = `${BASE_URL}/api/runs?${qs.toString()}`;
  return parse<T>(await fetch(url, { headers: headers() }));
}

export async function getRunDetail(sessionId: string): Promise<RunDetail> {
  const url = `${BASE_URL}/api/runs/${encodeURIComponent(sessionId)}`;
  return parse(await fetch(url, { headers: headers() }));
}

export async function getRunLogs(sessionId: string, stepId: string, opts?: { tail?: number }): Promise<LogLine[]> {
  const qs = new URLSearchParams();
  qs.set('stepId', stepId);
  if (opts?.tail) qs.set('tail', String(opts.tail));
  const url = `${BASE_URL}/api/runs/${encodeURIComponent(sessionId)}/logs?${qs.toString()}`;
  return parse(await fetch(url, { headers: headers() }));
}

export async function cancelRun(sessionId: string): Promise<void> {
  const url = `${BASE_URL}/api/runs/${encodeURIComponent(sessionId)}/cancel`;
  const res = await fetch(url, { method: 'POST', headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${res.statusText} — ${body.slice(0, 200)}`);
  }
}

export async function getFlows(): Promise<FlowDefinition[]> {
  const url = `${BASE_URL}/api/flows`;
  return parse(await fetch(url, { headers: headers() }));
}

export async function getProviders(): Promise<ProviderCategory[]> {
  const url = `${BASE_URL}/api/providers`;
  return parse(await fetch(url, { headers: headers() }));
}

export { BASE_URL };
```

- [ ] **Step 3: Write api/runs.ts (TanStack Query hooks)**

```typescript
// packages/ui/src/api/runs.ts
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { getRuns, getRunDetail, getRunLogs, cancelRun, getFlows, getProviders } from './client';
import { FilterStatus, FlowDefinition, LogLine, ProviderCategory, RunDetail, RunListResponse, RunStatus } from '@/types/api.types';

const RUNS_QUERY_KEY = ['runs'] as const;
const DETAIL_KEY = (id: string) => ['runDetail', id] as const;
const LOGS_KEY = (sessionId: string, stepId: string) => ['runLogs', sessionId, stepId] as const;

export function useRuns(filter: { status?: FilterStatus; productId?: string; search?: string; limit?: number }, intervalMs: number) {
  return useQuery<RunListResponse>({
    queryKey: RUNS_QUERY_KEY,
    queryFn: () => getRuns(filter),
    refetchInterval: (data) => {
      // If any run is running, poll faster
      if (intervalMs < 10000 && data?.data?.runs.some(r => r.status === 'running')) {
        return 5000;
      }
      return intervalMs;
    },
  });
}

export function useRunDetail(sessionId: string, intervalMs: number) {
  return useQuery<RunDetail>({
    queryKey: DETAIL_KEY(sessionId),
    queryFn: () => getRunDetail(sessionId),
    enabled: !!sessionId,
    refetchInterval: (data) => {
      return data?.data?.status === 'running' ? 5000 : false;
    },
  });
}

export function useLogs(sessionId: string, stepId: string) {
  return useQuery<LogLine[]>({
    queryKey: LOGS_KEY(sessionId, stepId),
    queryFn: () => getRunLogs(sessionId, stepId, { tail: 100 }),
  });
}

export function useCancelRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => cancelRun(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RUNS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: DETAIL_KEY('') }); // invalidate all detail queries
    },
  });
}

export function useFlows() {
  return useQuery<FlowDefinition[]>({
    queryKey: ['flows'],
    queryFn: getFlows,
  });
}

export function useProviders() {
  return useQuery<ProviderCategory[]>({
    queryKey: ['providers'],
    queryFn: getProviders,
  });
}
```

- [ ] **Step 4: Write stores**

```typescript
// packages/ui/src/stores/useProductStore.ts
import { create } from 'zustand'; // actually, use a simpler approach to avoid extra dep
```

Wait — let me not add Zustand as a dep. Use a simple approach:

```typescript
// packages/ui/src/stores/useProductStore.ts
import { useState, useCallback } from 'react';

const STORAGE_KEY = 'rv:selectedProduct';

function getStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch { return null; }
}

export function useProductStore() {
  const [selected, setSelected] = useState<string | null>(getStored);
  const onChange = useCallback((id: string | null) => {
    setSelected(id);
    try { localStorage.setItem(STORAGE_KEY, id ?? ''); } catch {}
  }, []);
  return { selected, onChange };
}
```

```typescript
// packages/ui/src/stores/useRefreshStore.ts
import { useState, useCallback } from 'react';

const STORAGE_KEY = 'rv:refreshInterval';

const INTERVALS = [5, 10, 30] as const;
type RefreshInterval = (typeof INTERVALS)[number];

function getStored(): RefreshInterval {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY) ?? '10', 10);
    return (INTERVALS.includes(v as any) ? v : 10) as RefreshInterval;
  } catch { return 10; }
}

export function useRefreshStore() {
  const [interval, setInterval] = useState<RefreshInterval>(getStored);
  const onChange = useCallback((v: RefreshInterval) => {
    setInterval(v);
    try { localStorage.setItem(STORAGE_KEY, String(v)); } catch {}
  }, []);
  return { interval, onChange, options: INTERVALS };
}
```

- [ ] **Step 5: Create vite-env.d.ts**

```typescript
// packages/ui/src/vite-env.d.ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_API_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 6: Create main.tsx and styles**

```typescript
// packages/ui/src/main.tsx
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/globals.css';
import App from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 3000, retry: 1 },
  },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </QueryClientProvider>
);
```

```css
/* packages/ui/src/styles/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-slate-50 text-slate-900 antialiased;
    font-family: Inter, system-ui, -apple-system, sans-serif;
  }
}

@keyframes pulse-ring {
  0% { transform: scale(0.8); opacity: 1; }
  100% { transform: scale(1.4); opacity: 0; }
}

.animate-pulse-ring {
  animation: pulse-ring 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
```

- [ ] **Step 7: Create App.tsx (router + providers)**

```typescript
// packages/ui/src/App.tsx
import { Routes, Route } from 'react-router-dom';
import AppShell from '@/components/layout/AppShell';
import RunList from '@/components/runs/RunList';
import RunDetail from '@/components/runs/RunDetail';

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<RunList />} />
        <Route path="/run/:sessionId" element={<RunDetail />} />
      </Routes>
    </AppShell>
  );
}
```

- [ ] **Step 8: Install dependencies**

Run: `cd /Users/sam-rego/data/workspace/journeyman/packages/ui && npm install`

- [ ] **Step 9: Create postcss.config.js**

```js
// packages/ui/postcss.config.js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 10: Create tailwind.config.js**

```js
// packages/ui/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.8)', opacity: '1' },
          '100%': { transform: 'scale(1.4)', opacity: '0' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
```

---

## Wave 2: Layout Shell

### Task 2.1: Sidebar and TopBar

**Files:**
- Create: `packages/ui/src/components/layout/AppShell.tsx`
- Create: `packages/ui/src/components/layout/Sidebar.tsx`
- Create: `packages/ui/src/components/layout/TopBar.tsx`

- [ ] **Step 1: Write AppShell.tsx**

```typescript
// packages/ui/src/components/layout/AppShell.tsx
import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

interface AppShellProps { children: ReactNode; }

export default function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-screen w-full flex-col">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write Sidebar.tsx**

```typescript
// packages/ui/src/components/layout/Sidebar.tsx
import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useProviders } from '@/api/runs';
import { useProductStore } from '@/stores/useProductStore';
import { ChevronDown, ChevronUp, Activity, LayoutDashboard } from 'lucide-react';

export default function Sidebar() {
  const { selected, onChange } = useProductStore();
  const { data: providers, isLoading } = useProviders();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const location = useLocation();

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
```

- [ ] **Step 3: Write TopBar.tsx**

```typescript
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
```

---

## Wave 3: Run List

### Task 3.1: RunList, RunCard, and filters

**Files:**
- Create: `packages/ui/src/components/runs/RunList.tsx`
- Create: `packages/ui/src/components/runs/RunCard.tsx`

- [ ] **Step 1: Write RunCard.tsx**

```typescript
// packages/ui/src/components/runs/RunCard.tsx
import { Link } from 'react-router-dom';
import { RunListItem, RunStep } from '@/types/api.types';
import StatusBadge from '@/components/shared/StatusBadge';
import ProgressBar from '@/components/shared/ProgressBar';

interface RunCardProps { run: RunListItem; steps?: RunStep[]; }

const STATUS_ICONS: Record<string, string> = {
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  blocked: 'blocked',
  pending: 'pending',
  cancelled: 'cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-blue-100 text-blue-700 border-blue-200',
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  failed: 'bg-rose-100 text-rose-700 border-rose-200',
  blocked: 'bg-amber-100 text-amber-700 border-amber-200',
  pending: 'bg-slate-100 text-slate-500 border-slate-200',
  cancelled: 'bg-slate-100 text-slate-400 border-slate-200',
};

export default function RunCard({ run, steps }: RunCardProps) {
  const completedSteps = steps?.filter(s => s.status === 'completed').length ?? 0;
  const totalSteps = steps?.length ?? 0;
  const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  const relativeUpdated = run.updatedAt ? relativeTime(run.updatedAt) : 'unknown';

  return (
    <Link
      to={`/run/${run.sessionId}`}
      className="group rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md hover:border-slate-300"
    >
      {/* Top row: product + ticket */}
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
          {run.productId}
        </span>
        <span className="text-sm font-medium text-slate-900">{run.ticketKey}</span>
        <span className="text-xs text-slate-400 truncate">{run.title}</span>
      </div>

      {/* Status */}
      <div className="mb-3 flex items-center gap-2">
        <StatusBadge status={run.status} />
        {totalSteps > 0 && (
          <span className="text-xs text-slate-500">{completedSteps}/{totalSteps} steps</span>
        )}
      </div>

      {/* Progress bar */}
      {totalSteps > 0 && (
        <div className="mb-3">
          <ProgressBar value={completedSteps} max={totalSteps} showPercent />
        </div>
      )}

      {/* Mini timeline */}
      {steps && steps.length > 0 && (
        <div className="mb-3 flex items-center gap-1 overflow-x-auto pb-1">
          {steps.map(step => {
            const color = STATUS_COLORS[step.status] || STATUS_COLORS.pending;
            const isRunning = step.status === 'running';
            return (
              <div key={step.stepId} className="flex flex-col items-center" title={`${step.name}: ${step.status}`}>
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full border text-[8px] ${color} ${
                    isRunning ? 'animate-pulse-ring' : ''
                  }`}
                >
                  {step.status === 'completed' ? '✓' : step.status === 'failed' ? '✕' : step.status === 'running' ? '↻' : step.status === 'blocked' ? '⏸' : '○'}
                </div>
                <span className="mt-0.5 text-[8px] text-slate-400">{step.name.slice(0, 6)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Timestamp */}
      <div className="text-xs text-slate-400">{relativeUpdated}</div>
    </Link>
  );
}
```

- [ ] **Step 2: Write RunList.tsx**

```typescript
// packages/ui/src/components/runs/RunList.tsx
import { useState, useMemo } from 'react';
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
```

---

## Wave 4: Run Detail

### Task 4.1: RunDetail and StepTimeline

**Files:**
- Create: `packages/ui/src/components/runs/RunDetail.tsx`
- Create: `packages/ui/src/components/runs/StepTimeline.tsx`

- [ ] **Step 1: Write StepTimeline.tsx**

```typescript
// packages/ui/src/components/runs/StepTimeline.tsx
import { RunStep } from '@/types/api.types';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

interface StepTimelineProps { steps: RunStep[]; onStepClick: (step: RunStep) => void; }

const STATUS_STYLES: Record<string, { circle: string; line: string; label: string; icon: string }> = {
  completed: { circle: 'fill-emerald-500 stroke-emerald-600', line: 'stroke-emerald-400', label: 'Completed', icon: '✓' },
  running: { circle: 'fill-blue-500 stroke-blue-600', line: 'stroke-blue-400', label: 'Running', icon: '↻' },
  failed: { circle: 'fill-rose-500 stroke-rose-600', line: 'stroke-rose-400', label: 'Failed', icon: '✕' },
  blocked: { circle: 'fill-amber-500 stroke-amber-600', line: 'stroke-amber-400', label: 'Blocked', icon: '⏸' },
  pending: { circle: 'fill-none stroke-slate-300', line: 'stroke-dashed stroke-slate-300', label: 'Pending', icon: '○' },
  cancelled: { circle: 'fill-slate-200 stroke-slate-300', line: 'stroke-slate-300', label: 'Cancelled', icon: '—' },
};

export default function StepTimeline({ steps, onStepClick }: StepTimelineProps) {
  const [hoveredStep, setHoveredStep] = useState<RunStep | null>(null);
  const [expandedStep, setExpandedStep] = useState<RunStep | null>(null);

  const statusColors = STATUS_STYLES;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-900">
          Pipeline: {steps[0]?.name || 'Unknown'} → ...
        </h2>
        <span className="ml-auto text-xs text-slate-400">
          {steps.filter(s => s.status === 'completed').length} / {steps.length} steps
        </span>
      </div>

      {/* Horizontal timeline */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-4">
        <svg className="min-w-[800px] h-24" viewBox="0 0 800 96">
          {/* Render steps left-to-right */}
          {steps.map((step, i) => {
            const x = 40 + i * (720 / Math.max(steps.length - 1, 1));
            const y = 48;
            const r = 20;
            const style = statusColors[step.status] || statusColors.pending;

            // Connection line to next step
            const lineColor = step.status === 'failed'
              ? 'stroke-rose-400'
              : step.status === 'running'
              ? 'stroke-blue-400'
              : i < steps.length - 1 && steps[i + 1].status === 'pending'
              ? 'stroke-slate-300 stroke-dashed'
              : step.status === 'completed'
              ? 'stroke-emerald-400'
              : 'stroke-slate-300';

            return (
              <g key={step.stepId}>
                {/* Line to next */}
                {i < steps.length - 1 && (() => {
                  const nextX = 40 + (i + 1) * (720 / Math.max(steps.length - 1, 1));
                  return (
                    <line
                      x1={x + r} y1={y}
                      x2={nextX - r} y2={y}
                      className={lineColor}
                      strokeWidth={2}
                    />
                  );
                })()}

                {/* Circle */}
                <motion.circle
                  cx={x} cy={y} r={r}
                  className={style.circle}
                  strokeWidth={2}
                  whileHover={{ scale: 1.2 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setExpandedStep(expandedStep?.stepId === step.stepId ? null : step)}
                  onMouseEnter={() => setHoveredStep(step)}
                  onMouseLeave={() => setHoveredStep(null)}
                  style={{ cursor: 'pointer' }}
                />

                {/* Icon */}
                <text
                  x={x} y={y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="pointer-events-none fill-white text-[10px]"
                >
                  {style.icon}
                </text>

                {/* Label */}
                <text
                  x={x} y={y + r + 14}
                  textAnchor="middle"
                  className="pointer-events-none fill-slate-500 text-[9px] font-mono"
                >
                  {step.name}
                </text>

                {/* Duration */}
                {step.duration && (
                  <text
                    x={x} y={y + r + 26}
                    textAnchor="middle"
                    className="pointer-events-none fill-slate-400 text-[8px] font-mono"
                  >
                    {step.duration}s
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Expanded step panel */}
      {expandedStep && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          <div className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-mono font-semibold text-slate-900">{expandedStep.name}</h3>
              <button onClick={() => setExpandedStep(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
              <div>Status: <span className="font-medium text-slate-700">{expandedStep.status}</span></div>
              <div>Duration: <span className="font-medium text-slate-700">{expandedStep.duration ? `${expandedStep.duration}s` : '—'}</span></div>
              <div>Started: <span className="font-medium text-slate-700">{expandedStep.startedAt || '—'}</span></div>
              <div>Ended: <span className="font-medium text-slate-700">{expandedStep.endedAt || '—'}</span></div>
              <div>Log lines: <span className="font-medium text-slate-700">{expandedStep.logLines}</span></div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Tooltip */}
      {hoveredStep && !expandedStep && (
        <div className="rounded bg-slate-900 px-2 py-1 text-xs text-white">
          {hoveredStep.name} — {hoveredStep.status} ({hoveredStep.duration ? `${hoveredStep.duration}s` : '...'})
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write RunDetail.tsx**

```typescript
// packages/ui/src/components/runs/RunDetail.tsx
import { useParams, Link } from 'react-router-dom';
import { useRunDetail, useLogs } from '@/api/runs';
import StepTimeline from './StepTimeline';
import LogPanel from '@/components/shared/LogPanel';
import EmptyState from '@/components/shared/EmptyState';
import StatusBadge from '@/components/shared/StatusBadge';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';

export default function RunDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { data: run, isLoading, error } = useRunDetail(sessionId!, 10000);
  const [activeTab, setActiveTab] = useState<'timeline' | 'logs'>('timeline');
  const [activeStep, setActiveStep] = useState<string | null>(null);

  const logs = useLogs(sessionId!, activeStep ?? '');
  const hasLogs = !!activeStep;

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="ml-2">Loading run details...</span>
      </div>
    );
  }

  if (error || !run) {
    return (
      <EmptyState title="Run not found" description={`Session "${sessionId}" could not be loaded.`}>
        <Link to="/" className="text-sm text-blue-600 hover:underline">← Back to runs</Link>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Back to runs
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900">{run.ticketKey}</h1>
            <StatusBadge status={run.status} size="md" />
            <span className="text-sm text-slate-500">{run.flowName}</span>
          </div>
          <p className="text-sm text-slate-400 font-mono">{run.sessionId}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-4">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`border-b-2 px-1 py-2 text-sm font-medium transition ${
              activeTab === 'timeline' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Timeline
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`border-b-2 px-1 py-2 text-sm font-medium transition ${
              activeTab === 'logs' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Logs
            {hasLogs && <span className="ml-1 text-xs text-slate-400">({logs.data?.length ?? 0} lines)</span>}
          </button>
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'timeline' && <StepTimeline steps={run.steps} onStepClick={(s) => { setActiveTab('logs'); setActiveStep(s.stepId); }} />}

      {activeTab === 'logs' && hasLogs && <LogPanel lines={logs.data} loading={logs.isLoading} error={logs.error?.message} stepId={activeStep} />}
      {activeTab === 'logs' && !hasLogs && (
        <EmptyState title="No step selected" description="Click a step on the timeline to view its logs.">
          <button onClick={() => setActiveTab('timeline')} className="text-sm text-blue-600 hover:underline">Back to timeline</button>
        </EmptyState>
      )}
    </div>
  );
}
```

---

## Wave 5: Shared Components & Polish

### Task 5.1: StatusBadge, ProgressBar, EmptyState, LogPanel

**Files:**
- Create: `packages/ui/src/components/shared/StatusBadge.tsx`
- Create: `packages/ui/src/components/shared/ProgressBar.tsx`
- Create: `packages/ui/src/components/shared/EmptyState.tsx`
- Create: `packages/ui/src/components/shared/LogPanel.tsx`

- [ ] **Step 1: Write StatusBadge.tsx**

```typescript
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
```

- [ ] **Step 2: Write ProgressBar.tsx**

```typescript
// packages/ui/src/components/shared/ProgressBar.tsx
interface ProgressBarProps { value: number; max: number; showPercent?: boolean; }

export default function ProgressBar({ value, max, showPercent }: ProgressBarProps) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-blue-500 transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Write EmptyState.tsx**

```typescript
// packages/ui/src/components/shared/EmptyState.tsx
import { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
  children?: ReactNode;
}

export default function EmptyState({ title, description, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 py-16">
      <Inbox className="mb-3 h-8 w-8 text-slate-300" />
      <h3 className="text-sm font-medium text-slate-500">{title}</h3>
      <p className="mt-1 max-w-xs text-center text-xs text-slate-400">{description}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Write LogPanel.tsx**

```typescript
// packages/ui/src/components/shared/LogPanel.tsx
import { useState } from 'react';
import { LogLine } from '@/types/api.types';
import { ChevronDown, ChevronUp, Terminal, Loader2 } from 'lucide-react';

interface LogPanelProps {
  lines?: LogLine[];
  loading?: boolean;
  error?: string;
  stepId: string;
}

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: 'text-slate-400',
  INFO: 'text-slate-500',
  WARN: 'text-amber-500',
  ERROR: 'text-rose-500',
};

export default function LogPanel({ lines, loading, error, stepId }: LogPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-600">
        Error loading logs: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading logs...
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between border-b border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-slate-400" />
          <span>Logs for step: {stepId}</span>
          <span className="text-xs text-slate-400">({lines?.length ?? 0} lines)</span>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="max-h-[400px] overflow-auto bg-slate-950 p-4 font-mono text-xs">
          {lines && lines.length > 0 ? (
            lines.map(line => (
              <div key={line.id} className="leading-relaxed">
                <span className="text-slate-500">{line.timestamp}</span>{' '}
                <span className={`${LEVEL_COLORS[line.level] || 'text-slate-400'} font-medium`}>{line.level}</span>{' '}
                <span className="text-slate-300">{line.message}</span>
              </div>
            ))
          ) : (
            <div className="text-slate-500">No logs available for this step.</div>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## Wave 6: Final Validation

### Task 6.1: Typecheck, install, and verify

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ui`
Expected: No errors

- [ ] **Step 2: Build**

Run: `npm run build --workspace=@journeyman/ui`
Expected: `dist/` directory created

- [ ] **Step 3: Start dev server**

Run: `npm run dev --workspace=@journeyman/ui`
Then verify in browser at `http://localhost:5173`:
- Sidebar shows product list
- Run list shows cards with status badges
- Clicking a card navigates to run detail
- Step timeline renders horizontally
- Polling updates work

- [ ] **Step 4: Commit**

When the user asks you to commit (do NOT auto-commit):

```bash
git add packages/ui/
git commit -m "$(cat <<'EOF'
feat(ui): add run visualizer SPA

Vite + React + TypeScript SPA for visualizing pipeline runs:
- Product selector sidebar with API-backed provider list
- Run card grid with status badges, progress bars, mini timelines
- Horizontal step timeline on run detail page
- Polling (5s/10s/30s) via TanStack Query
- Status colors: completed=emerald, running=blue, failed=rose, blocked=amber
- Log panel with syntax highlighting by level
- Empty states, error handling, responsive grid layout

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- Architecture (Vite + TS + Tailwind + Radix + Lucide + TanStack + Router + Framer Motion) — Wave 0, Task 1.1
- AppShell (Sidebar 260px + main area) — Wave 2, Task 2.1
- Run list with responsive grid, filters (product, status multi-select, search) — Wave 3, Task 3.1
- RunCard with all fields (product tag, ticket key, status, mini-timeline, progress, timestamp) — Wave 3, Task 3.1
- RunDetail with horizontal step timeline — Wave 4, Task 4.1
- Step node click → expand panel with metadata — Wave 4, Task 4.1
- Polling 10s list, 5s running — Wave 1, Task 1.1 (useRuns refetchInterval)
- Status colors (completed=emerald, running=blue pulse, failed=rose, blocked=amber, pending/cancelled=slate) — Wave 5, Task 5.1
- API endpoints: /api/runs, /api/runs/:id, /api/runs/:id/logs, /api/runs/:id/cancel, /api/flows, /api/providers — Wave 1, Task 1.1 (client.ts)
- Error handling (unreachable API, 404, empty logs) — Task 3.1, Task 4.1
- Top bar with refresh selector + connection status — Wave 2, Task 2.1
- All type definitions match spec — Wave 1, Task 1.1

**2. Placeholder scan:** No "TBD", "TODO", "implement later", or "similar to" patterns found.

**3. Type consistency:** RunStatus, RunListItem, RunDetail, RunStep, LogLine used consistently across api.types.ts, client.ts, runs.ts hooks, and all components. Status color values match between StatusBadge and RunCard/StepTimeline.
