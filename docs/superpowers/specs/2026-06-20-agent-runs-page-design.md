# Agent Runs Page — Design

**Date:** 2026-06-20
**Status:** Ready for implementation

## Overview

A dedicated workspace-level page for browsing and inspecting agent runs. Agent runs are workflow instances tagged with `agentId` — but the existing `/workflow-instances` page is too generic (canvas view, workflow-centric language). This page gives an agent-centric view: list all runs across every agent in the workspace, click into a run to see agent-specific metadata and a rich log panel.

## Pages

### 1. List page — `/workspaces/:wsId/agent-runs`

Workspace-wide table of all agent runs, newest first, paginated at **20 per page**.

**Header controls:**
- Title: "Agent Runs"
- Scope chips (pill toggles): **All** · **Running** · **Failed** — filter by status group. "All" is the default active chip.
- Agent dropdown: "All agents" + per-agent options — filters to a single agent's runs.
- Trigger dropdown: "All triggers" · Manual · Webhook · Schedule · API.

**Table columns:**

| Column | Detail |
|---|---|
| Agent | Agent name, `font-weight:500` |
| Status | `je-runslist__pill` style — `running` (blue + pulsing dot), `completed` (green), `failed` (red), `cancelled` (muted), `paused` (amber) |
| Trigger | `triggerSource` + provider if webhook (e.g. `webhook · github`, `schedule`, `manual`, `api`) |
| Started | Relative time (e.g. "8 min ago", "yesterday") |
| Duration | Formatted ms → `1m 48s`; shows `0m 12s…` while running |
| Model | `provider · model` in monospace 11px (e.g. `claude · sonnet-4-6`) |
| — | Re-run button (`btnSecondary` style) on non-running rows only |

**Running rows:** status pill includes a pulsing dot (same `live-dot` animation used in the run-viewer).

**Pagination:** `1–20 of N` with Prev / Next buttons (`btnSecondary`).

**Clicking a row** navigates to the detail page.

---

### 2. Detail page — `/workspaces/:wsId/agent-runs/:runId`

Agent-centric view of a single run. Does **not** embed the workflow canvas — instead links out to it.

#### Header

```
Agent Runs / {agentName}
{agentName}    [status pill]
run_{id} · {relative time}              [Open workflow instance →]
```

- Breadcrumb links back to the list page.
- Status pill matches `je-runview__pill` styles (same tokens as run-viewer).
- "Open workflow instance →" is a `btnSecondary` button that navigates to `/workspaces/:wsId/workflow-instances/:runId`.

#### Stat strip

Four label-over-value pairs separated by one hairline border-bottom:

| Label | Value |
|---|---|
| Trigger | `triggerSource` + provider (e.g. `Webhook · GitHub`) |
| Duration | Formatted duration; "running…" while active |
| Model | `provider · model` |

#### Detail rows

Definition-list layout (`120px label / 1fr value`):

- **Repository** — `owner/repo → PR #N` (link to PR if present; omitted if no repo)
- **Inputs** — JSON object in monospace, muted colour
- **Output** — plain text summary if `outputMode: "text"`; omitted if `outputMode: "none"`

#### Logs panel

Directly reuses the `WorkflowLogsPanel` component from `@journeyman/run-viewer` with one adaptation: **step chips are hidden** because agent runs have a single custom-AI step (no multi-node filtering needed).

The panel retains all other `WorkflowLogsPanel` features:

- **Header:** `Logs (filtered / total)` · search input · Auto-scroll checkbox · ↑ Top / ↓ Bottom / ⧉ Copy buttons
- **Kind chips:** Assistant · Tools · Tool results · Results · Errors — toggle to filter by `LogKind`
- **Log rows:** `[time] [▸ caret if hasMeta] [line]` coloured by kind. Click a row with `▸` to expand the raw event payload as an inline `<pre>` JSON block.
- **Scrollable:** fixed-height panel with its own scroll; page height is stable regardless of log volume.

**Live / running state:**

- Status pill pulses (animated dot).
- A `LIVE` badge (pulsing dot + label) appears next to the log count.
- Auto-scroll label highlights in the info colour when active.
- The last incoming log line shows a blinking `▌` cursor.
- A bottom bar reads "Streaming live · auto-scrolling to latest" with a "Pause scroll" link that unchecks auto-scroll.
- The panel connects via SSE (same `openWorkflowInstanceEventStream` used in `RunDetailPage`) and polls for new events while the run is active.

Once the run reaches a terminal status (`completed` / `failed` / `cancelled`), the SSE connection closes, the LIVE badge disappears, and Duration + Usage fill in.

---

## Backend changes

### New endpoint: workspace-wide agent runs list

```
GET /api/workspaces/:wsId/agent-runs
  ?status=running|completed|failed|cancelled|paused
  &agentId=<uuid>
  &trigger=manual|webhook|schedule|api
  &page=1
  &pageSize=20
```

Returns paginated `AgentRunSummary[]` enriched with `agentName`, `agentId`, `triggerSource`, `provider`, `model`, `durationMs`, `inputs`, `outputs`.

Implementation: query `jm_workflow_instances` filtered by `inputs->>'agentId' IS NOT NULL` and the agent's `workspaceId`. Join agent name from `jm_agents`.

### Existing per-agent endpoint (unchanged)

`GET /api/workspaces/:wsId/agents/:id/runs` — still used by `RunHistorySection` on the agent detail page. Its links update to point to `/agent-runs/:runId` instead of `/workflow-instances/:runId`.

### Run detail data

`GET /api/workspaces/:wsId/agent-runs/:runId` — returns a single enriched run (agent name, provider, model, usage if available) plus the existing events array. Can be a thin wrapper over the existing `getRun` + agent lookup.

---

## Navigation

- New sidebar entry **Agent Runs** under the workspace nav group (between Agents and Workflows, or after Agents — consistent with the sidebar redesign spec).
- Route: `/workspaces/:wsId/agent-runs`
- `RunHistorySection` on the agent detail page updates its row links from `/workflow-instances/:id` → `/agent-runs/:id`.

---

## Components

| Component | Location | Notes |
|---|---|---|
| `AgentRunsPage` | `packages/web/src/routes/AgentRunsPage.tsx` | List page |
| `AgentRunDetailPage` | `packages/web/src/routes/AgentRunDetailPage.tsx` | Detail page |
| `AgentRunsList` | `packages/web/src/components/agents/AgentRunsList.tsx` | Table + filters |
| Logs panel | reuse `WorkflowLogsPanel` from `@journeyman/run-viewer` | Hide step chips via prop or conditional |

`WorkflowLogsPanel` needs a small addition: a `hideStepChips?: boolean` prop. When `true`, the step-chips filter row is not rendered. Agent runs have one workflow node (the custom-AI step), so the step-chips row would show a single chip that filters to everything — a no-op that wastes space. Pass `hideStepChips={true}` from `AgentRunDetailPage`.

---

## Out of scope

- Usage / token cost data — `WorkflowInstance` has no token/cost field; deferred to a future spec.
- Cancel / pause actions on the detail page — link to workflow instance covers that for now.
- Per-agent run count badge in the sidebar — future.
