# Flow Draft / Ready Status — Design

**Date:** 2026-05-07
**Status:** Proposed

## Problem

Flows today have no lifecycle state. Anything that exists in the DB is potentially live: webhooks fire, schedules tick, the "new run" dialog runs them. There's no way for an author to say "I'm still working on this — don't run it yet" without deleting and re-creating, and no enforcement that a flow is structurally complete before it goes live.

We need:

1. A status authors can set — `draft` while building, `ready` once it's safe to run.
2. Pipelines (webhook, schedule, manual run, retry) are gated on `ready`.
3. Permissive saves while in `draft` — partial / broken graphs are fine.
4. Strict validation on the `draft → ready` transition.
5. Authors can flip back to `draft` to make changes.

## Decisions

| # | Decision |
|---|---|
| 1 | Status field: `"draft" \| "ready"` on `FlowDefinition`. |
| 2 | Status gates **execution**, not visibility. Draft flows are visible but cannot be triggered. |
| 3 | Ready flows are **read-only** in the editor. Author must explicitly move to Draft to edit. |
| 4 | Flipping Ready → Draft: in-flight runs continue, **new** triggers rejected with `409 flow_not_ready`. Pre-flip warning if active. |
| 5 | Saves in Draft: permissive (A1) — anything structurally parseable saves. |
| 6 | Draft → Ready: full validation gate (graph + trigger + config + bindings + gates + secret/MCP/skill references). |
| 7 | New flows default to `draft`. Existing flows migrate to `draft` (forces author re-validation). |
| 8 | Per-run `flowSnapshot` already exists — runs are deterministic against their snapshot regardless of subsequent status flips. |
| 9 | UI: top-bar status pill + primary button (Publish / Move to Draft) + dedicated modals for both transitions. |

## Data model

`packages/core/src/types/flow.types.ts`:

```ts
export type FlowStatus = "draft" | "ready";

export interface FlowDefinition {
  // ...existing fields
  status: FlowStatus;
}
```

DB migration:

- Add column `status text not null default 'draft'`.
- Backfill: all existing rows → `'draft'`.
- Drop default after backfill so future inserts must set it explicitly via the API layer.

Per-run `flowSnapshot` is unchanged. Runs already freeze the flow JSON at trigger time, so live status mutations never affect in-flight runs.

## Validation

New module `validateForPublish(flow: FlowDefinition): PublishValidationResult` in `packages/flow-editor/src/state/validation.ts` (also re-exported for server use).

```ts
export type PublishError = {
  code: string;
  message: string;
  nodeId?: string;
  fieldPath?: string;
};

export type PublishValidationResult =
  | { ok: true }
  | { ok: false; errors: PublishError[] };
```

Checks performed (all must pass):

| Check | Code | Notes |
|---|---|---|
| Existing structural validity | `graph_invalid` | Wraps `isValidPhase4Graph`. |
| At least one trigger configured | `no_trigger` | Webhook, schedule, or `allowsManual` flag. |
| No disconnected nodes | `orphan_node` | Per offending node. |
| Required phase config filled | `missing_config` | Driven by `PhaseDefinition` required fields (model, secrets, MCPs, skills). |
| Bindings resolve to real upstream outputs | `unresolved_binding` | Per binding. |
| Gate conditions parse + reference real fields | `invalid_gate` | If/else nodes. |
| Referenced secrets/MCPs/skills exist | `dangling_reference` | Catches deletions of dependencies after authoring. |

**Where it runs:**

- **Client** (flow-editor): runs on publish-modal open for live feedback.
- **Server** (`POST /flows/:id/publish`): authoritative — client checks are advisory.

**Saves in Draft** call only the existing structural sanity check; semantic issues are surfaced as inline warnings but never block save.

## API surface

`packages/api-server/src/routes/flows.ts`:

| Endpoint | Behavior |
|---|---|
| `POST /flows/:id/publish` | Runs `validateForPublish`. On success, sets `status='ready'`, returns updated flow. On failure, `400 { errors: PublishError[] }`. |
| `POST /flows/:id/unpublish` | Sets `status='draft'`. Body: `{ confirm?: boolean }`. If in-flight runs > 0 or any active webhook/schedule and `confirm` is absent → `409 { warning: { inFlightRunCount, activeTriggers: { webhooks, schedules } } }`. Client re-submits with `confirm: true`. |
| `PUT /flows/:id` (existing save) | If current status is `'ready'` → `409 { error: 'flow_is_ready' }`. Author must unpublish first. |
| `POST /flows/:id/run` (manual trigger) | If `status !== 'ready'` → `409 { error: 'flow_not_ready' }`. |
| Webhook ingress | Same gate. Returns `409` to caller. |
| Scheduler tick | Same gate. Skip + log; do not error the scheduler. |
| Retry endpoint (existing `retryable` flag) | Same gate. A flow that has been moved back to draft cannot be retried until re-published — but in-flight runs against the snapshot continue normally. |

The trigger gate is a single helper (`assertFlowReady(flowId)`) called from each ingress path so the rule lives in one place.

Worker / cli-worker: no changes. Workers only see snapshots.

## Editor UI

**Top bar (`FlowEditor.tsx`)**

- Status pill next to flow name. `Draft` = amber, `Ready` = green.
- Primary button is status-driven:
  - `draft` → **Publish** (opens publish modal).
  - `ready` → **Move to Draft** (opens unpublish dialog).

**Read-only mode when `status === 'ready'`:**

- `useFlowEditorState` exposes a `readOnly` flag.
- Canvas: drag/drop disabled, no node deletion, no edge editing.
- Palette: hidden or disabled.
- Properties panel and flow-config panel: all inputs `disabled`.
- Save handlers no-op (server would reject anyway).
- A subtle banner: "This flow is published and read-only. Move to Draft to edit."

**Publish modal**

- Runs `validateForPublish` on mount.
- Shows a checklist with green ✓ / red ✗ rows. Each red row carries the `PublishError` message.
- Clicking a red row with `nodeId` closes the modal and selects the offending node on the canvas.
- "Publish" button disabled until all rows pass; clicking calls `POST /publish`.
- On success → status flips to Ready, editor enters read-only mode.

**Unpublish dialog**

- If no in-flight runs and no active triggers → simple confirm ("Move to Draft? You'll be able to edit again.").
- Otherwise → warning dialog summarising counts ("2 running pipelines, 1 active webhook"). Confirms with `{ confirm: true }`.
- After unpublish, editor leaves read-only mode.

**Other surfaces**

- Flow list: status pill on each row.
- New-run dialog: Run/Trigger button disabled for Draft flows with tooltip "Publish this flow to run it."

## Migration plan

1. Add type + DB column with default `'draft'`.
2. Backfill existing rows → `'draft'`.
3. Drop default.
4. Ship API gates + UI in the same release.
5. Communicate to users that all flows have been moved to Draft and need to be re-published. Re-publish requires passing the validation gate.

## Out of scope

- Versioning / "draft on top of ready" (rejected option C in Q2).
- Per-environment status (dev/staging/prod).
- Approval workflows (multi-author publish).
- Scheduling auto-publish.

## Open questions

- **Test runs from the editor while in Draft.** Current decision treats *all* triggers (including manual) as gated on Ready. If authors need to smoke-test a flow before publishing, we'll need either (a) a separate "test run" path that bypasses the gate but is clearly marked, or (b) require publish to test. Flagging here for confirmation during planning.
