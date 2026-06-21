# Dashboard UX Tweaks — Design

**Date:** 2026-06-21
**Status:** Approved (design); pending implementation plan
**Scope:** Small UX fixes to the existing workspace dashboard. No backend changes.

## In plain words

Three small front-end fixes to the workspace dashboard:

1. **It scrolls.** Right now the page is taller than the viewport and gets cut off because the app shell clips overflow. Make the dashboard body scroll like every other page.
2. **Hover shows the number.** Charts and bars currently show no value on hover. Add a minimal, built-in browser tooltip on each data element so hovering reveals its label + value.
3. **Header & label polish.** A workspace crumb, a live "updated Xs ago" indicator, a divider under the header, small accent bars on band headers, and consistent number formatting.

## Context

- The app shell ([packages/web/src/components/AppShell.tsx](../../../packages/web/src/components/AppShell.tsx)) renders `<main style={{ flex: 1, overflow: "hidden" }}>` inside a fixed `height: 100vh` column. Each page must own its own scroll container. Working pages (e.g. [AgentsPage.tsx](../../../packages/web/src/routes/AgentsPage.tsx)) wrap content in `<div className="h-full overflow-y-auto">`.
- [DashboardPage.tsx](../../../packages/web/src/routes/DashboardPage.tsx) wraps the dashboard in `<div style={{ padding: 20 }}>` with **no height/overflow**, so it is clipped → "scrolling not working".
- The widgets in [packages/workspace-dashboard/src/widgets.tsx](../../../packages/workspace-dashboard/src/widgets.tsx) (`Bars`, `Donut`, `HBars`, `Sparkline`) and the leaderboard table render no `title`/tooltip, so there is no hover info.

All changes are confined to `@journeyman/workspace-dashboard` (widgets + bands + `Dashboard.tsx`) and one wrapper line in `@journeyman/web`'s `DashboardPage.tsx`.

## Design

### 1. Scrolling

Change the `DashboardPage` outer wrapper from `<div style={{ padding: 20 }}>` to the same scroll container the other pages use:

```tsx
<div className="h-full overflow-y-auto">
  <div style={{ padding: 20 }}>
    <Dashboard … />
  </div>
</div>
```

`h-full` fills the `<main>` box; `overflow-y-auto` scrolls when content exceeds it. No other layout change.

### 2. Hover info — native `title` tooltips (minimal, zero-dependency)

Each data element gets a browser-native tooltip showing `label + value`. No tooltip library, no React state, no positioning code — just `title` attributes / SVG `<title>` children. Content per widget:

| Widget | Hover target | Tooltip text (example) |
|---|---|---|
| `Bars` (run volume, activity/day) | each bar `<div>` | `Thu · 80` — bar needs its label+value passed in (currently it only takes `number[]`) |
| `Donut` (outcomes) | each `<circle>` segment (`<title>` child) | `Completed · 271` |
| `HBars` (triggers, providers, token mix) | each row `<div>` | `claude · 2,711,540 tokens` (full value, not the abbreviated one) |
| `Sparkline` (duration) | small `<circle>` dots added per point (a `<polyline>` can't carry per-point titles), each with a `<title>` | `2026-06-18 · 3m 41s` |
| Leaderboard | each `<td>` already shows the value; add `title` on the tokens cell for the exact count | `1,903,212 tokens` |

**Interface impact:** `Bars` currently takes `data: number[]`. To label tooltips it needs each bar's label + value. Change its prop to **`bars: { label: string; value: number }[]`**; the component renders each bar with `title={`${label} · ${value}`}` and derives `max` from the values. The calling bands (`TrendsBand` run-volume, `AgentsBand` activity/day) map their `DayCount[]` to `{ label: day, value: count }`. This is the only prop-shape change.

The styled bubble shown in the mockup illustrates *content only* — the shipped tooltip is the plain OS hover tooltip.

### 3. Header & labels polish (in `Dashboard.tsx`)

- **Workspace crumb** above the `Dashboard` title. The crumb text (workspace name) is passed in as a new optional `workspaceName?: string` prop from `DashboardPage` (which can read it from `useWorkspace()`); falls back to nothing if absent.
- **Live "updated Xs ago"** indicator next to the window selector: a green pulse dot + relative time. Driven by a `lastUpdated?: Date | number` prop (or the live-query's `dataUpdatedAt`) passed from `DashboardPage`; recomputed on render. If absent, the indicator is hidden.
- **Divider** (`border-bottom`) under the header row.
- **Accent bar** on each band header (a left `border-left` accent), keeping the existing emoji + uppercase label.
- **Consistent formatting** using the existing `format.ts` helpers (`formatTokens`, `formatDuration`) and `Math.round(x*100)` for percentages; tidy captions and empty-state text.

## Non-goals

- No charting library, no custom/animated tooltip component (native `title` only).
- No backend/API changes, no new endpoints, no new data.
- No density/theme-color overhaul (the hardcoded palette stays this pass).

## Testing

- **Unit:** the only logic worth a test is any new pure helper (e.g. a `formatAgo`/relative-time helper if added — `format.ts` already has `formatAgo`). Assert `formatAgo`/formatting outputs. Widget rendering is presentational; no new logic tests needed beyond existing `format.test.ts`.
- **Manual/verification:** dashboard scrolls when content exceeds the viewport; hovering a bar/slice/row/point/cell shows the expected label+value; header shows crumb + updated indicator.
- **Gate (per standing instruction):** `npm run typecheck` (no new errors beyond the pre-existing flow-editor baseline) + the package's `npm test`. No commits.

## Open questions

None. Tooltip mechanism decided (native `title`); polish items confirmed.
