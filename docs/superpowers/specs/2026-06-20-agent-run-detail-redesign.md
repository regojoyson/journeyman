# Agent Run Detail Page — Redesign

**Date:** 2026-06-20  
**Status:** Approved  
**File:** `packages/web/src/routes/AgentRunDetailPage.tsx`

## Problem

The current `AgentRunDetailPage` uses a `maxWidth: 860` centered column with inline styles. It looks pinched on wide screens and is visually inconsistent with the newer `AgentDetail` page, which uses a full-bleed `h-full flex flex-col` layout with Tailwind classes.

## Goal

Replace the narrow centered layout with the same pattern used by `AgentDetail`:
- Full-bleed, full-height layout
- Sticky page header (breadcrumb + title + status + action button)
- A card with a vertical sidebar nav and tabbed content panels
- Tailwind classes throughout — no inline styles

## Layout Structure

```
<div className="h-full flex flex-col overflow-hidden">        ← page root

  <header className="shrink-0 border-b bg-background ...">   ← sticky header
    breadcrumb / title / status pill / run ID+time / "Open workflow" button
  </header>

  <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6"> ← scrollable body

    <div className={`${card} overflow-hidden`}>               ← card
      <div className="flex min-h-[500px]">

        <aside className="w-44 shrink-0 border-r p-3">       ← sidebar nav
          <RunSectionNav active={section} onSelect={setSection} />
        </aside>

        <div className="flex-1 p-6">                          ← content panel
          {section === "details"  && <RunDetailsPanel  ... />}
          {section === "logs"     && <RunLogsPanel     ... />}
          {section === "tokens"   && <RunTokensPanel   ... />}
        </div>

      </div>
    </div>

  </div>
</div>
```

## Tabs

| Tab | Section ID | Default? | Content |
|-----|-----------|---------|---------|
| Details | `details` | ✓ | Key-value grid of run metadata |
| Logs | `logs` | | `WorkflowLogsPanel` at natural height |
| Tokens & Cost | `tokens` | | Placeholder ("coming soon") |

## Details Tab

Two-column key-value grid (`grid-cols-[130px_1fr]`). Rows shown when data is present:

| Label | Value |
|-------|-------|
| Trigger | `wi.triggerSource` |
| Duration | `formatDuration(wi.durationMs)` or `"running…"` |
| Model | `${provider}${model ? ` · ${model}` : ""}` |
| Repository | `repoName` (only if present) |
| Pull Request | Link to `prUrl` labelled `PR #${prNumber}` (only if present) |
| Inputs | JSON of `displayInputs` (with `agentId` stripped), monospace code block (only if non-empty) |
| Output | `outputText` from `wi.outputs.result` or `wi.outputs.summary` (only if present) |

## Logs Tab

Renders `<WorkflowLogsPanel>` with:
- `events={allEvents}` (merged historical + live SSE events — same logic as today)
- `nodes={[]}`
- No `height` prop / no `onResizeHeight` — tab owns the vertical space, no draggable handle needed
- `hideStepChips` and `onClose={() => {}}` preserved
- `resizeEdge` prop omitted

## Tokens & Cost Tab

Placeholder panel:
- Centered icon + heading: "Token usage & cost tracking coming soon"
- Sub-text: "Once token tracking is wired up in the backend, you'll see input tokens, output tokens, and estimated cost per run here."
- No wiring to data — purely presentational.

## New Components

| Component | Location | Purpose |
|-----------|---------|---------|
| `RunSectionNav` | `packages/web/src/components/agents/sections/RunSectionNav.tsx` | Vertical nav with sections: Details, Logs, Tokens & Cost |
| `RunDetailsPanel` | inline in `AgentRunDetailPage.tsx` or extract if long | Key-value grid |
| `RunLogsPanel` | inline in `AgentRunDetailPage.tsx` | Wraps `WorkflowLogsPanel` |
| `RunTokensPanel` | inline in `AgentRunDetailPage.tsx` | Placeholder |

`RunSectionNav` follows the exact same pattern as `SectionNav` in `packages/web/src/components/agents/sections/SectionNav.tsx` — same Tailwind classes, same active/hover states.

## State

`section` state replaces `logHeight` state. `liveEvents`, `detail`, `agent`, `loading`, `error` are unchanged.

```typescript
type RunSectionId = "details" | "logs" | "tokens";
const [section, setSection] = useState<RunSectionId>("details");
```

`logHeight` and `onResizeHeight` are removed — no longer needed.

## Styling

- All inline styles replaced with Tailwind classes
- Import `card`, `btnSecondary` from `admin-styles.ts` (same as today)
- Status pill stays as a local component — same pill colors, converted to Tailwind

## What Does Not Change

- Data fetching logic (`getRun`, `agentsApi.get`, SSE stream via `openWorkflowInstanceEventStream`)
- `allEvents` merge memo
- `StatusPill` component (colours, structure)
- `fmtRelative` utility
- Breadcrumb links and "Open workflow instance" button target
- Loading / error states
