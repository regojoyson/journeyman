# Agent Run History tab — redesign

**Date:** 2026-06-21
**Status:** Approved (design)
**Area:** `@journeyman/web` — agent editor, Run History section

## Problem

The Run History tab in the agent detail view
([RunHistorySection.tsx](../../../packages/web/src/components/agents/sections/RunHistorySection.tsx))
calls `agentsApi.runs(wsId, agentId)` → `GET /api/workspaces/:wsId/agents/:id/runs`,
which returns a hard-capped list (`LIMIT 50`, **no pagination**) of bare rows
`{ id, status, started_at, completed_at }`. It renders an unstyled 3-column table:
raw status text, raw ISO timestamps, no duration, no trigger source, no paging.

## Goal

Make the Run History tab match the rest of the agent editor and the workspace-wide
runs view: paginated, newest-first, with status pills, trigger source, relative
timestamps, and durations. **No backend changes** — the needed endpoint already exists.

Scope (confirmed with user): pagination + visual polish, newest-first ordering.
**Out of scope (YAGNI):** filters, re-run button, agent/model columns.

## Approach

### 1. Data source — switch to the existing paginated endpoint

Replace `agentsApi.runs(...)` with the existing `agentsApi.listRuns(wsId, { agentId, page, pageSize })`
→ `GET /api/workspaces/:wsId/agent-runs?agentId=…&page=…&pageSize=…`.

It returns `AgentRunsPage { runs: AgentRunEnriched[]; total; page; pageSize }`, already
ordered `started_at DESC NULLS LAST` (newest-first). `AgentRunEnriched` provides
`status`, `triggerSource`, `startedAt`, `completedAt`, `durationMs`, `provider`, `model`,
`agentName`, `inputs`, `outputs` — everything the table needs.

Default `pageSize: 10`.

### 2. Extract shared run-status visuals

`StatusPill` and `fmtRelative` currently live as private helpers inside
[AgentRunsList.tsx](../../../packages/web/src/components/agents/AgentRunsList.tsx).
Move them into a new shared module `packages/web/src/components/agents/shared/run-status.tsx`
and import them in both `AgentRunsList` and the new `RunHistorySection`, so the
single-agent tab and the workspace-wide list render identical pills and relative times.

`StatusPill` references a `jePulse` CSS animation that is **not defined anywhere** — the
running-state dot is currently silently static. Add `@keyframes jePulse` to the web app's
`styles.css` so the running dot pulses in both views.

### 3. Rebuild the table (native Tailwind, matching the section)

Render inside `SectionShell title="Run history" description="Past executions of this agent, newest first."`.

Columns (Run ID link always present):

| Run | Status | Trigger | Started | Duration |
|---|---|---|---|---|
| `r.id.slice(0,8)` monospace link → `/workspaces/:wsId/agent-runs/:id` | `<StatusPill status={r.status} />` | icon + `r.triggerSource` | `fmtRelative(r.startedAt)`, full ISO on `title` hover | `formatDuration(...)` — running rows show live elapsed `…` |

Styling matches the other editor sections / `AgentRunsList`: uppercase muted `<th>`,
`border-t` rows, `hover:bg-accent`, monospace run id. Preserve `Loading…` and
`No runs yet.` states.

Duration logic mirrors `AgentRunsList`:
```ts
r.status === "running"
  ? `${formatDuration(r.startedAt ? Date.now() - new Date(r.startedAt).getTime() : null)}…`
  : formatDuration(r.durationMs)
```

### 4. Pagination footer

`{from}–{to} of {total}` plus Prev/Next using `btnSecondary`, identical to the
`AgentRunsList` footer. `page`/`pageSize` held in `useState`; refetch on change.
Buttons disable at bounds (`page <= 1`, `page >= ceil(total/pageSize)`).

## Components / files

- **New:** `packages/web/src/components/agents/shared/run-status.tsx` — `StatusPill`, `fmtRelative` (moved, exported).
- **Edit:** `packages/web/src/components/agents/AgentRunsList.tsx` — import the two helpers from the shared module, delete the local copies.
- **Edit:** `packages/web/src/components/agents/sections/RunHistorySection.tsx` — full rewrite: `listRuns`, paginated table, footer.
- **Edit:** web `styles.css` — add `@keyframes jePulse`.
- **New:** `packages/web/src/components/agents/sections/RunHistorySection.test.tsx`.

No changes to `@journeyman/core`, API server, or DB.

## Error handling

- Fetch failure → render the existing empty/error fallback (`No runs yet.` / caught error), as today.
- `startedAt === null` → `fmtRelative` returns `—`; duration blank.

## Testing

Add `RunHistorySection.test.tsx` (mirrors `RunAgentModal.test.tsx` / `agent-form.test.ts` patterns):
- Mocks `agentsApi.listRuns`; asserts rows render with pill text, trigger, relative time, and duration.
- Empty state renders `No runs yet.`
- Next/Prev change `page` and trigger a refetch with the new page; buttons disable at bounds.

## Constraints (per user)

- Work on `master` branch only — no feature branch.
- No commits.
- Run `npm run typecheck` (and the web test) at the end only.
