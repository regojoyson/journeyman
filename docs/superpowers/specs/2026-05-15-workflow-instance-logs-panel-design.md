# Workflow Instance Logs Panel — Design

**Date:** 2026-05-15
**Status:** Approved, ready for implementation planning
**Package:** `@journeyman/run-viewer`

## Problem

Today, the run viewer only surfaces logs *per phase*: the user must click a phase node on the canvas, and the right-side `NodeDetailDrawer` shows that one phase's `phase.log` events via `PhaseLogsSection`. There is no way to see logs across the whole workflow instance in one place — making it hard to follow a run end-to-end, spot cross-phase interactions, or grep for an error without clicking each phase in turn.

## Goal

Add a unified, cross-phase logs view — analogous to the Chrome DevTools console — that:

- Aggregates `phase.log` events from every phase plus workflow-level events.
- Is hidden by default and opened via a toolbar toggle.
- Docks to the bottom of the run viewer.
- Is drag-resizable vertically.
- Lets the user filter by log kind, by phase, and by free-text search.
- Coexists with the existing per-phase `PhaseLogsSection` in the right drawer (no removal, no auto-linking).

## Non-goals

- Virtualizing the log list (current per-phase view is also un-virtualized; revisit if performance becomes an issue).
- Streaming/tail mode beyond the existing auto-scroll behavior.
- Persisting filter selections across page loads (only open-state and height are persisted).
- Backend changes — this is purely a view over data already streamed to the run viewer.

## Architecture

### File layout

```
packages/run-viewer/src/
├── RunViewer.tsx               ← layout changes (grid gains a bottom row)
├── topbar/RunTopbar.tsx        ← adds "Show logs" / "Hide logs" toggle button
├── drawer/PhaseLogsSection.tsx ← refactored to use shared parse-logs helper; behavior unchanged
└── logs/                       ← NEW
    ├── WorkflowLogsPanel.tsx
    ├── parse-logs.ts           ← shared log parsing/classification (used by both views)
    └── types.ts                ← LogKind, ParsedLog
```

### Layout

`RunViewer.tsx` currently uses a CSS grid `canvas | resizer | drawer`. It changes to two rows:

```
┌────────────────────────────────────────┐
│ WorkflowInstanceTopbar                 │
├──────────────┬─┬───────────────────────┤
│ Canvas       │R│ NodeDetailDrawer      │   ← existing row
│              │ │                       │
├──────────────┴─┴───────────────────────┤
│ ━━━━━━━━ drag handle (top) ━━━━━━━━━━ │   ← only present when open
│ WorkflowLogsPanel                      │   ← only present when open
└────────────────────────────────────────┘
```

- When `logsOpen` is `false`, the bottom row collapses to `0px` and the drag handle is not rendered.
- When `logsOpen` is `true`, the bottom row renders the panel with height `logsHeight`, and a `PanelResizer` (reused from `@journeyman/flow-editor` with `side="top"`) lives on the top edge for height resize.

### Toggle button

Lives in `RunTopbar` alongside the existing Refresh/Export buttons. Label flips between `Show logs` and `Hide logs`. A count badge shows total log events (all events of type `phase.log` plus all non-`phase.log` events).

### Persistence (localStorage)

- `je-runview:logsOpen` — boolean
- `je-runview:logsHeight` — number, default `240`, clamped to `[120, 0.7 × window.innerHeight]`

Existing `je-runview:drawerWidth` persistence is untouched.

## Panel Contents

Top to bottom inside `WorkflowLogsPanel`:

### Header row (sticky)

- Title: `Logs (N visible / M total)`
- Right side controls: Auto-scroll checkbox, `↑ Top`, `↓ Bottom`, `⧉ Copy`, `✕ Close` — same control set and behavior as `PhaseLogsSection`.

### Filter rows

1. **Kind chips** — same six kinds and colors as `PhaseLogsSection`: Assistant, Tools, Tool results, Results, Errors, Other. Click to toggle.
2. **Phase chips** — one chip per nodeId that has produced ≥1 log, labeled `displayName ?? phaseType ?? type ?? nodeId` (same fallback chain as `RunViewer.tsx:35`). Plus an "All" pseudo-chip that clears the phase filter. Multi-select.
3. **Free-text search** — case-insensitive substring match against the log line.

### Log list (scrollable, fills remaining height)

Each row renders:

```
12:04:31  [PhaseName]  🔧 Bash: ls -la
```

- Timestamp (left, monospace).
- Phase-name pill (clickable: clicking the pill replaces the phase filter with just that one phase).
- The log line itself, colored by `kind`.
- Click row to expand `meta` JSON (same behavior as `PhaseLogsSection`).
- Auto-scroll-to-bottom logic preserved from `PhaseLogsSection` (the `wasNearBottomRef` "tail when near bottom" trick).

### Empty states

- No events at all → `(no logs yet)`.
- Events exist but filters hide everything → `(all filters hide every log)`.

## Data Flow & State

### Component props

```ts
interface WorkflowLogsPanelProps {
  events: WorkflowInstanceEvent[];
  nodes: WorkflowNode[];   // for nodeId → displayName lookup
  onClose: () => void;
}
```

No new props on `WorkflowInstanceViewer`. The panel reads from data the viewer already has.

### State owned by `RunViewer.tsx`

- `logsOpen: boolean` — persisted as `je-runview:logsOpen`.
- `logsHeight: number` — persisted as `je-runview:logsHeight`.

### State local to `WorkflowLogsPanel`

- `activeKinds: Record<LogKind, boolean>` — defaults all true.
- `activePhases: Set<string>` — empty set means "all phases".
- `search: string`.
- `expanded: Set<number>` — expanded `meta` row ids.
- `autoScroll: boolean`.

### Derivation (memoized)

```
allLogs   = parseLogs(events, nodes)
filtered  = allLogs
  .filter(l => activeKinds[l.kind])
  .filter(l => activePhases.size === 0 || activePhases.has(l.nodeId))
  .filter(l => !search || l.line.toLowerCase().includes(search.toLowerCase()))
```

### `parseLogs` helper (`logs/parse-logs.ts`)

A pure function extracted from the existing logic inside `PhaseLogsSection`:

```ts
export interface ParsedLog {
  id: number;
  ts: Date;
  nodeId: string | null;       // null for workflow-level events
  phaseName: string;           // resolved via the nodes map; "Workflow" for nodeId-less events
  line: string;
  kind: LogKind;
  meta?: Record<string, unknown>;
}

export function parseLogs(
  events: WorkflowInstanceEvent[],
  nodes: WorkflowNode[],
): ParsedLog[];
```

- `phase.log` events: payload `{ line, meta? }`, classified by emoji prefix (`🤖`/`🔧`/`📥`/`✅`/`❌` → `assistant`/`tool`/`tool_result`/`result_ok`/`result_err`; otherwise `other`).
- Non-`phase.log` events: rendered with `kind: "other"`, `nodeId: null`, `phaseName: "Workflow"`, and a synthesized `line` via a small `formatWorkflowEvent(ev)` helper (e.g. `[status] running → completed`).
- Output preserves input order and `id`.

After extraction, `PhaseLogsSection` is refactored to call `parseLogs(eventsForSelected, nodes)` and pre-filter to the one selected `nodeId`. Behavior, colors, and DOM structure of the existing per-phase view remain unchanged.

## Edge Cases

- **No logs yet** — empty-state placeholder.
- **All filtered out** — distinct placeholder explaining filters hide everything.
- **Viewer remount** — localStorage restores `logsOpen` and `logsHeight`.
- **Height vs viewport** — clamp on read and on window resize.
- **Missing displayName** — fall back chain `displayName → phaseType → type → nodeId`.
- **Workflow-level events without nodeId** — labeled `Workflow`; excluded from the per-phase chip filter; still respect kind/search filters.
- **Very large log volume** — un-virtualized for now (matches existing `PhaseLogsSection`). Flagged as a known limitation, not in scope.
- **Right drawer logs view** — completely unchanged in behavior; both panels read from the same `props.events`, so they stay in sync without explicit wiring.

## Testing

### Unit tests (`logs/parse-logs.test.ts`)

- Classifies emoji-prefixed lines into correct `LogKind`s.
- Attaches `phaseName` from the nodes map; falls back correctly when name is missing.
- Tags workflow-level events as `nodeId: null`, `phaseName: "Workflow"`.
- Preserves event order and `id`.

### Component smoke tests

Only added if a React testing setup already exists in `packages/run-viewer`. Otherwise skipped — introducing a test framework purely for this feature is out of scope. (Verify during implementation planning.)

## Out-of-scope / future work

- Virtualization for very long runs.
- Persisting filter selections across reloads.
- A keyboard shortcut to toggle the panel (e.g. `Ctrl/Cmd + ` `).
- Auto-linking canvas selection to the bottom panel's phase filter.

## Files touched (summary)

| File | Change |
|---|---|
| `packages/run-viewer/src/logs/types.ts` | New — `LogKind`, `ParsedLog` |
| `packages/run-viewer/src/logs/parse-logs.ts` | New — pure parsing/classification helper |
| `packages/run-viewer/src/logs/parse-logs.test.ts` | New — unit tests |
| `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx` | New — bottom panel UI |
| `packages/run-viewer/src/drawer/PhaseLogsSection.tsx` | Refactor to use `parseLogs`; no behavior change |
| `packages/run-viewer/src/topbar/RunTopbar.tsx` | Add "Show/Hide logs" toggle button + count badge |
| `packages/run-viewer/src/RunViewer.tsx` | Grid layout gains bottom row; owns `logsOpen` / `logsHeight` state + localStorage |
| `packages/run-viewer/src/styles.css` | Styles for the bottom panel, chips, search box, phase pills |
