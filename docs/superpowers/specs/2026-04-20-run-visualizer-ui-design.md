# Run Visualizer UI — Design Spec

## Overview

A standalone Vite + TypeScript SPA in `packages/ui/` that visualizes Journeyman pipeline runs from the Management REST API. Provides product selection, run listing with status cards, and a horizontal step flow timeline on the run detail page. Updates via polling (5s for list, 10s for running runs).

---

## Architecture

```
packages/ui/
├── public/
├── src/
│   ├── main.tsx                    ← App entry
│   ├── App.tsx                     ← Router + providers
│   ├── api/
│   │   ├── client.ts               ← Fetch wrapper + auth token
│   │   └── runs.ts                 ← API hooks for /api/runs, /api/runs/:id, etc.
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx         ← Full app frame
│   │   │   ├── Sidebar.tsx          ← Product selector + nav
│   │   │   └── TopBar.tsx           ← Refresh timer + connection status
│   │   ├── runs/
│   │   │   ├── RunList.tsx          ← Card grid of runs
│   │   │   ├── RunCard.tsx          ← Single run card
│   │   │   ├── RunDetail.tsx        ← Detail page
│   │   │   └── StepTimeline.tsx     ← Horizontal step flow diagram
│   │   ├── shared/
│   │   │   ├── StatusBadge.tsx      ← Color-coded status
│  │   │   ├── ProgressBar.tsx        ← Step progress bar
│  │   │   ├── LogPanel.tsx           ← Collapsible log viewer
│  │   │   └── EmptyState.tsx         ← No runs / no product
│   ├── stores/
│   │   ├── useApiStore.ts           ← Query data + polling (TanStack Query)
│   │   └── useProductStore.ts       ← Selected product
│   ├── styles/
│   │   └── globals.css              ← Tailwind + custom styles
│   └── types/
│       └── api.types.ts             ← Manual types for API response shapes
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── .env.example
```

### Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Build | Vite 5 | Fast dev, standard for React SPAs |
| Language | TypeScript (strict) | Already in monorepo |
| Styling | Tailwind CSS | Utility-first, fast iteration, easy dark mode |
| UI components | Radix UI primitives + Headless UI | Accessibility, unstyled, composable |
| Icons | Lucide React | Clean, lightweight, tree-shakeable |
| State/fetch | TanStack Query (React Query) 5 | Polling, caching, background refetch |
| Router | React Router 7 | Standard, file-based or config-based |
| Animations | Framer Motion | Subtle transitions for timeline and cards |

> **No custom framework or design system.** Uses existing monorepo tooling (npm workspaces, typescript).

---

## Pages & Components

### 1. App Shell (`AppShell`)

- **Sidebar** (left, 260px): product selector (combobox dropdown), active route
- **Main area** (rest of width): page content
- **Top Bar** (full-width, 56px): page title, refresh interval selector (5s/10s/30s), connection status indicator

### 2. Run List / Dashboard

#### Layout
- Responsive grid: 3 columns on wide, 2 on medium, 1 on narrow
- Sort by most recently updated (descending)

#### Run Card
Each card shows:

```
┌──────────────────────────────────────┐
│ [Product]   Ticket: PROJ-123         │
│                          completed   │
│                                      │
│  3/7 steps    ████████░░ 60%        │
│                                      │
│  [✅][✅][🔄][⏸][❌][⏳][⏳]         │
│  get    clone   analyze  plan  ...    │
│                                      │
│  Updated: 2 min ago                  │
└──────────────────────────────────────┘
```

Cards include:
- **Top row**: Product tag (pill style) + Ticket key/short title on the left
- **Status badge**: Color-coded pill (green/completed, blue/running, red/failed, yellow/blocked, gray/cancelled)
- **Inline mini-timeline**: Small circles per step (✅ completed, 🔄 running with pulse, ❌ failed, ⏸ blocked, ⏳ pending) in gray outline
- **Progress bar**: Filled portion based on completed steps / total steps
- **Updated timestamp**: Relative time ("2 min ago") with absolute time on hover

#### Filters

Three filter controls at top of list view:

1. **Product** — Dropdown, shows all products from `/api/providers` (or hardcoded list from config as fallback)
2. **Status** — Multi-select: All, Running, Completed, Failed, Blocked, Cancelled
3. **Search** — Text input for ticket key / run session ID

### 3. Run Detail Page

#### Horizontal Step Timeline

```
┌─────────────────────────────────────────────────────── Run: PROJ-123 ─────────────────────────────────────────────────┐
│                                                                                                                        │
│   [✅ getTicket]──[✅ cloneRepos]──[✅ analyze]──[⏳ plan]──[⏳ implement]──[⏳ commitPush]──[⏳ createPR]──[⏳ cleanup] │
│                        │              │              │              │              │                   │              │
│                        ▼              ▼              ▼              ▼              ▼                   ▼              ▼
│                    repo paths      analysis      plan docs     implementation      commit      PR #42           cleaned
│                        │              │              │              │              │                   │              │
│                        2m            5m            12m            8m          ...                  ...
│                                                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Step node:
- **Completed (✅)**: Green circle with checkmark, connected line solid green
- **Running (🔄)**: Blue circle with animated pulse ring, line solid blue
- **Failed (❌)**: Red circle with X, line solid red
- **Blocked (⏸)**: Yellow circle with pause icon, line solid yellow
- **Pending**: Gray circle outline (not filled), line dashed gray
- **Hover**: Shows tooltip with step name, status, duration

Each node connects to its next step via a colored line. Lines are:
- **Solid green**: step succeeded
- **Solid red**: step failed (subsequent steps are grayed out)
- **Solid blue**: step is running
- **Dashed gray**: step is pending or not yet reached

#### Clicking a step node
Expands a panel below the timeline (or slides in from the right) showing:

1. **Step metadata**: Name, status, duration, started/ended timestamps
2. **Logs**: Collapsible log lines fetched from `/api/runs/:sessionId/logs?stepId=...&tail=100`
3. **Artifacts**: List of artifacts produced by this step, with download links

---

## API Integration

### API Client

Single `api/client.ts` file:
- Base URL from `VITE_API_URL` env var (default: `http://localhost:3000`)
- Auth header from `VITE_API_TOKEN` env var or `.env` file
- `fetch()` wrapper with error handling

### API Endpoints Used

| Endpoint | Purpose |
|---------|---------|
| `GET /api/runs?limit=50&offset=0` | Run list (with status filter) |
| `GET /api/runs/:sessionId` | Run detail with steps |
| `GET /api/runs/:sessionId/logs?stepId=X&tail=100` | Step logs |
| `GET /api/runs/:sessionId/stream` | SSE live events for running runs |
| `POST /api/runs/:sessionId/cancel` | Cancel a run |
| `GET /api/flows` | Flow definitions |
| `GET /api/providers` | Available providers |

### Polling Strategy

- **Run list view**: Poll every 10 seconds (configurable to 5s or 30s)
- **Running runs**: Poll every 5 seconds (detected during list refresh)
- **On poll**: TanStack Query handles caching, dedup, and invalidation
- **Connection**: Visual indicator in top bar (green = connected, red = error)

---

## Styling & Theme

### Color system
- **Background**: White / slate-50
- **Surface**: White cards with subtle shadow
- **Text**: Slate-900 primary, slate-500 secondary
- **Borders**: Slate-200
- **Focus**: Blue-500 ring

### Status colors
- **Completed**: Emerald
- **Running**: Blue with subtle pulse animation
- **Failed**: Rose with X icon
- **Blocked**: Amber with pause icon
- **Pending / Cancelled**: Slate (disabled look)

### Typography
- **Headings**: Inter or system sans-serif, bold
- **Body**: Inter or system sans-serif, regular
- **Monospaced**: Source Code Pro or JetBrains Mono for logs
- **Timeline labels**: Monospaced, smaller size

---

## State Management

### TanStack Query caches:
- `runs` — list of runs (`GET /api/runs`)
- `runs:detail:<id>` — single run (`GET /api/runs/:id`)
- `runs:logs:<id>:<stepId>` — step logs
- `runs:artifacts:<id>:<key>` — artifact download

### Local stores:
- **selectedProduct**: Persisted in localStorage, default = "all"
- **refreshInterval**: Persisted in localStorage, default = 10s
- **expandedSteps**: Set of step IDs expanded in detail view

---

## Error Handling

| Scenario | UI behavior |
|----------|-------------|
| API unreachable | Top bar shows red banner, run cards show "Connection lost" overlay |
| Invalid token | Login redirect to configure API token in env/file |
| Run not found | 404 page with back button to run list |
| Step logs empty | "No logs available" message in log panel |
| Artifact download fails | Toast notification with retry button |

---

## File Structure Detail

### Core components (detailed)

```
src/components/shared/StatusBadge.tsx
  Props: { status: RunStatus; size?: 'sm' | 'md' }
  Renders: color-coded pill with icon

src/components/shared/ProgressBar.tsx
  Props: { value: number; max: number; showPercent?: boolean }
  Renders: horizontal progress bar

src/components/shared/LogPanel.tsx
  Props: { lines?: LogLine[]; loading?: boolean; error?: string; stepId: string }
  Renders: collapsible scrollable log viewer

src/components/runs/RunCard.tsx
  Props: { run: RunListItem; onClick: () => void }
  Renders: summary card with mini timeline

src/components/runs/RunDetail.tsx
  Props: { run: RunDetail; onBack: () => void }
  Renders: full detail page with timeline and step panels

src/components/runs/StepTimeline.tsx
  Props: { steps: Step[] }
  Renders: horizontal connected node diagram

src/components/layout/Sidebar.tsx
  Props: { products: ProductOption[]; selected: string; onChange: (id) => void }
  Renders: product combobox + route links
```

### Types (mirroring API)

```typescript
// src/types/api.types.ts

type RunStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';

interface RunListItem {
  sessionId: string;
  productId: string;
  flowName: string;
  ticketKey: string;
  status: RunStatus;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
}

interface RunDetail extends RunListItem {
  steps: RunStep[];
  artifacts: ArtifactMeta[];
}

interface RunStep {
  stepId: string;
  name: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  duration: number | null;
  logLines: number;
}

interface LogLine {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  source: string;
}

interface ProductOption {
  id: string;
  name: string;
}
```

---

## Implementation Phases

1. **Phase 1 - Scaffold & shell**: Vite setup, TypeScript config, Tailwind, App shell, sidebar, routing
2. **Phase 2 - Run list**: API client, query hooks, RunList component, RunCard with mini timeline, filters
3. **Phase 3 - Run detail**: RunDetail page, StepTimeline component, step node click/expand, log panel
4. **Phase 4 - Polish**: Animations, status colors, error states, empty states, responsive layout

---

## Key Design Decisions & Rationale

| Decision | Why |
|----------|-----|
| Vite + monorepo package | Independent dev server, fast HMR, shared types |
| TanStack Query for data | Built-in polling, caching, dedup — exactly what we need |
| Horizontal timeline | Natural pipeline metaphor (ticket → PR), scales wide on desktop |
| Polling over SSE | Simpler architecture, no long-lived connections across page navigations |
| Tailwind + unstyled primitives (Radix/Headless) | Speed of development without framework constraints |
| Manual API types (not generated) | API spec is already documented; keeping types lightweight avoids codegen overhead |
| Polling interval configurable | Users may want fast updates during a run or lower frequency for browsing history |

---

## Open Questions

None — decisions made during brainstorming:
- [x] Standalone Vite SPA in monorepo
- [x] Horizontal step flow timeline (default view)
- [x] Polling-based refresh (5s running, 10s list)
- [x] All run card fields (all selected)
- [x] Product selector in sidebar
- [x] React + TypeScript + Tailwind
