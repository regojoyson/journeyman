# Agent Run Modal — Design

**Date:** 2026-06-21
**Status:** Approved, ready for implementation plan
**Scope:** `@journeyman/web` only — no backend, API, or type changes.

## Summary

Let users start an agent run from a modal in two places:

1. **Agents list page** — show a `Run` button on each row, but only when the agent is `enabled`. Clicking opens a run modal.
2. **Agent detail page** — replace the existing inline run form with the same modal.

In both cases, submitting the modal calls the existing `runNow` API and navigates to the agent run view page. A single shared component, `RunAgentModal`, backs both entry points so input rendering and submit logic live in one place.

## Motivation

Today there is no way to run an agent from the list page. On the detail page, "Run now" expands an inline form and, on success, switches to the in-page "runs" section rather than the dedicated run view. This unifies the two flows behind one modal and sends the user to the run they just started.

## Existing pieces this reuses (no changes needed)

- `agentsApi.runNow(wsId, agentId, inputs)` → `POST /api/workspaces/:wsId/agents/:id/runs`, returns `{ workflowInstanceId, engineWorkflowId }`.
- Run view route: `/workspaces/{wsId}/agent-runs/{workflowInstanceId}` ([AgentRunDetailPage.tsx](../../../packages/web/src/routes/AgentRunDetailPage.tsx)).
- `Agent.enabled: boolean` and `Agent.inputs: AgentInputField[]` from `@journeyman/core` agent types.
- The project modal pattern: `fixed inset-0 z-50 … bg-overlay` overlay + `card` body (e.g. [SandboxFormModal.tsx](../../../packages/web/src/components/sandboxes/SandboxFormModal.tsx)).
- Existing inline input-rendering logic in [AgentDetail.tsx](../../../packages/web/src/components/agents/AgentDetail.tsx) (lifted into the new component).

## Component: `RunAgentModal`

**Location:** `packages/web/src/components/agents/shared/RunAgentModal.tsx` (alongside the existing `shared/` folder).

**Props:**

```ts
interface RunAgentModalProps {
  wsId: string;
  agent: Agent;
  onClose: () => void;
  onStarted?: (workflowInstanceId: string) => void; // optional hook; default behavior navigates
}
```

**Behavior:**

- **Header:** title "Run agent" + the agent name as a subtitle + a close (`×`) control.
- **Body — with inputs:** render each field in `agent.inputs` honoring `type` (`text` / `number` / `boolean`), `required`, `default`, and `description`. Initialize each field's value from its `default`. Booleans render as a checkbox; text/number as the matching input.
- **Body — no inputs:** when `agent.inputs` is empty, show a single confirmation line: "Run **{agent.name}**? This agent takes no inputs."
- **Footer:** Cancel (ghost) + Run (primary). Run is disabled while submitting and while any `required` field is empty.
- **Submit:** call `agentsApi.runNow(wsId, agent.id, inputs)`. On success, use the returned `workflowInstanceId` to navigate to `/workspaces/{wsId}/agent-runs/{workflowInstanceId}` (via `onStarted` if provided, otherwise navigate directly). On error, render the message inline inside the modal and keep it open.
- Uses the existing overlay + `card` modal styling. Closing via Cancel, the `×`, or backdrop calls `onClose`.

## Integration A — Agents list page

**File:** [packages/web/src/components/agents/AgentsList.tsx](../../../packages/web/src/components/agents/AgentsList.tsx)

- Add a `Run` button in each row's action cell, rendered only when `agent.enabled` is true. It sits before the existing "Open" button.
- Add `runTarget: Agent | null` state. Clicking `Run` sets `runTarget` to that row's agent.
- Render `<RunAgentModal>` when `runTarget` is set, passing `wsId` and `runTarget`. `onClose` clears `runTarget`. On success the modal navigates to the run view page (default behavior), leaving the list.

## Integration B — Agent detail page

**File:** [packages/web/src/components/agents/AgentDetail.tsx](../../../packages/web/src/components/agents/AgentDetail.tsx)

- The "Run now" button (shown when the agent is enabled) opens `RunAgentModal` instead of expanding the inline form.
- Remove the inline run-form state and its rendering. Move its input-rendering logic into `RunAgentModal` so there is no duplication.
- On success, navigate to the run view page `/workspaces/{wsId}/agent-runs/{workflowInstanceId}` instead of switching to the in-page "runs" section.

## Out of scope

- No changes to `runNow`, the agents API routes, or `@journeyman/core` types.
- No changes to the run view page itself.
- No changes to trigger configuration, scheduling, or webhook flows.

## Testing

- Unit-level: `RunAgentModal` renders the correct fields for an agent with mixed input types; Run is disabled until required fields are filled; the no-inputs variant shows the confirmation line and an enabled Run button.
- Behavior: submitting calls `runNow` with the collected input values and navigates to `/workspaces/{wsId}/agent-runs/{workflowInstanceId}`; an API error keeps the modal open and shows the message.
- Integration: the list page shows the Run button only for enabled agents; the detail page no longer renders an inline form.
