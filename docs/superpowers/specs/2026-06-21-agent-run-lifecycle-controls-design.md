# Agent Run Lifecycle Controls — Design

**Date:** 2026-06-21
**Status:** Approved (design)

## Problem

The agent run detail view (`/workspaces/:wsId/agent-runs/:runId`, `AgentRunDetailPage`) shows no action controls. The workflow instance view (`/workspaces/:wsId/workflow-instances/:id`) offers Pause, Resume, Cancel, Retry-step, Re-run, Fork, and Export. Users want lifecycle controls on the agent run view too.

## Key Fact

**Agent runs are workflow instances.** An agent run is a row in `jm_workflow_instances` where `inputs->>'agentId' IS NOT NULL` (an agent compiled to a `WorkflowGraph` and submitted via `runAgent`). The agent run's `id` *is* a workflow-instance id — the page loads it with the same `getRun()` call the workflow-instance view uses, and already links to "Open workflow instance →".

The existing lifecycle endpoints load the record by id and only check workspace ownership (`loadInstance(id, wsId)` in `packages/api-server/src/routes/workflow-instances.ts`). They therefore **already operate correctly on agent runs** — no agent-specific backend exists or is needed. The agent run *view* simply renders no buttons.

## Scope

Controls to add (chosen subset of the workflow-instance controls — Retry-step, Fork, and Export are excluded as not meaningful/requested for agent runs):

- **Cancel / Stop**
- **Pause** + **Resume**
- **Re-run**

## Approach

**Backend: no changes.** Reuse the existing workflow-instance endpoints, which already work on agent run ids:

- `POST /api/workspaces/:wsId/workflow-instances/:id/cancel`
- `POST /api/workspaces/:wsId/workflow-instances/:id/pause`
- `POST /api/workspaces/:wsId/workflow-instances/:id/resume`
- `POST /api/workspaces/:wsId/workflow-instances/:id/rerun`

The dedicated-`/agent-runs/:id/*`-routes alternative was rejected: it duplicates working logic for no functional gain.

**Frontend: add an inline button cluster to the agent page header.** `AgentRunDetailPage` uses local `useState` + `getRun` (not react-query like `RunDetailPage`). Rather than reuse the `useRunActions` hook (coupled to react-query invalidation and hardcoded workflow-instance navigation on re-run), call the existing `api/runs.ts` functions (`cancelRun`, `pauseRun`, `resumeRun`, `rerunRun`) directly with a local busy flag and a refetch. `RunTopbar` is **not** shared/extracted — it is inline-styled in the run-viewer package while the agent page is Tailwind; four gated buttons inline is simpler than bridging the two.

## Frontend Detail

**File:** `packages/web/src/routes/AgentRunDetailPage.tsx`

**Location:** A button cluster in the header (`<header>`), beside the existing "Open workflow instance →" link.

**Controls & status gating** (mirroring `RunTopbar` semantics; status read from `detail.workflowInstance.status`, terminal via existing `isTerminalStatus`):

| Button | Shown when | API call |
|---|---|---|
| ⏸ Pause | status `running` | `pauseRun(wsId, id)` |
| ▶ Resume | status `paused` | `resumeRun(wsId, id)` |
| ⏹ Cancel | not terminal | `cancelRun(wsId, id)` |
| ↻ Re-run | terminal | `rerunRun(wsId, id)` |

**Wiring:**

- Add local `busy` state; disable all buttons while a request is in flight.
- Add a `refetch()` helper that re-runs `getRun(wsId, runId)` → `setDetail(...)`. Call it on success of Cancel/Pause/Resume so the status pill and button visibility update.
- **Re-run navigation:** on success, navigate to `/workspaces/${wsId}/agent-runs/${res.workflowInstanceId}` (keep the user in the agent context, unlike the generic hook which routes to `/workflow-instances/:id`).
- **Permission gating:** hide the entire cluster for viewers using `!can("resource.write")` from `useWorkspace()`, exactly as `RunDetailPage` (line 27) does.
- **Engine support / errors:** Pause/Resume may return `501` when the engine doesn't support them (same as workflow instances). On any action failure, surface a small inline error line in the header; do not fail silently.

## Out of Scope

- No backend routes, orchestrator, or DB changes.
- No changes to the workflow-instance view or `RunTopbar`.
- No Retry-step, Fork, or Export on the agent run view.
- No change to the existing status-refresh behavior of the page beyond the post-action `refetch()`.

## Testing / Verification

- `npm run check` (typecheck + import boundaries).
- Manual via browser preview:
  - Open a **running** agent run → see Pause + Cancel; pause it → pill shows paused, Resume appears; resume → back to running.
  - Open a **terminal** agent run → see Re-run; click → lands on the new agent-run view.
  - As a **viewer** role → no controls shown.
  - Trigger a failure (e.g. engine without pause support) → inline error shown.
