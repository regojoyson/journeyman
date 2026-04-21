# @journeyman/ui — Run Visualizer

A Vite + React SPA for visualizing Journeyman pipeline runs from the Management API.

## Quick Start

```bash
cd packages/ui
cp .env.example .env
npm install
npm run dev
# → http://localhost:5173
```

## Configuration

Copy `.env.example` to `.env` and set:

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Management API base URL |
| `VITE_API_TOKEN` | (none) | Bearer token for auth |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with HMR |
| `npm run build` | Type-check and production build |
| `npm run preview` | Preview production build locally |
| `npm run typecheck` | Run `tsc --noEmit` |

## Architecture

```
packages/ui/
├── src/
│   ├── api/
│   │   ├── client.ts       ← Fetch wrapper + auth headers
│   │   └── runs.ts         ← TanStack Query hooks (polling, caching)
│   ├── components/
│   │   ├── layout/         ← AppShell, Sidebar, TopBar
│   │   ├── runs/           ← RunList, RunCard, RunDetail, StepTimeline
│   │   └── shared/         ← StatusBadge, ProgressBar, EmptyState, LogPanel
│   ├── stores/             ← LocalStorage-backed product & refresh stores
│   ├── types/              ← API response type definitions
│   ├── styles/             ← Tailwind + custom animations
│   ├── App.tsx             ← Router + providers
│   └── main.tsx            ← React root
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

## Features

- **Run dashboard**: responsive card grid (3 → 2 → 1 cols) with status badges, progress bars, and inline mini-timelines
- **Filters**: status multi-select, search by ticket key or session ID
- **Run detail**: horizontal step timeline with clickable nodes and metadata panels
- **Polling**: configurable 5s/10s/30s refresh interval (faster 5s during active runs)
- **Connection status**: live indicator in the top bar
