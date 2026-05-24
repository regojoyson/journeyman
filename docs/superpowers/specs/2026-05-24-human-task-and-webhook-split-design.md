# Human Task & Webhook — Split Design

**Date:** 2026-05-24
**Status:** Draft (approved direction; ready for implementation plan)

## Problem

Today the `human-task` node does two unrelated jobs in one config screen:

1. **Ask a person something** — render a form, wait for them to submit.
2. **Wait for a system event** — match an incoming webhook by `listensFor`, `acceptIf`, extract values via `fromPath`.

The author sees both sets of fields on every human-task they place. The mental model
leaks: "human task" should be about humans; webhook-matching JSONLogic predicates have
no business there. Tools the team and users already know (n8n, Dify, LangFlow) keep
these as distinct first-class nodes. We will too.

## Decision

Split into two node types, sharing the same underlying Conductor pause primitive but
with completely separate configuration UIs:

| Node | Purpose | Config concepts |
|---|---|---|
| **`human-task`** | Ask a person, wait for their answer | Question, form fields, notify, timeout |
| **`webhook-wait`** | Wait for a system event | Provider, event types, accept-if, extraction paths |

Webhook ingest stays as it is today: **one URL per provider** (`POST /webhooks/:provider`),
internally routed first to "resume a paused waiter", else to "start a new workflow",
else ignored. No change to how providers (Jira/GitHub/GitLab/etc.) are configured —
each still gets a single registered webhook URL.

## Out of scope (deferred)

- **Slack/email button resolution via callback URLs** (`POST /callbacks/wait/:id`).
  Notifications in v1 are a "you have a task waiting — open in app" link. Inline
  Approve/Reject buttons can land in a later phase.
- **Assignee / role-based resolve gating.** Anyone with run access can resolve. May
  formalize later.
- **`webhook-trigger` node type for start-of-flow webhooks.** Today triggers are
  flow-level settings; promoting them to a graph node is a separate design.

## Human Task — new behavior

### Author experience

A Human Task node's config panel shows only:

- **Question** — prompt shown to the human. *"Approve deploy to prod?"*
- **Fields** — declared outputs the human fills in. Each has `name`, `type`
  (`string` | `number` | `boolean` | `json` | `date`), optional `label`,
  `description`, `required`, `default`.
- **Notify** *(optional)* — who to ping when the task pauses, via which channel
  (Slack DM / email). Carries a deep link to the resolve page in the app.
- **Timeout** *(optional)* — `duration` plus `defaults` (one default per declared
  field). When the duration elapses, the task auto-resolves with those defaults.

No `listensFor`, no `acceptIf`, no `fromPath` on this node. Those concepts no longer
exist for human tasks.

### Runtime flow

1. Workflow reaches the node → Conductor pauses.
2. Task appears in the user's **My Tasks** list in the web app.
3. If Notify is configured, the engine dispatches the notification (Slack DM /
   email) with a link back to the resolve page. The notification is best-effort:
   delivery failure is logged but does not fail the workflow — the task is still
   resolvable in-app.
4. Human opens the task, fills the form, submits.
   `POST /workflow-instances/:id/human-tasks/:nodeId/resolve` is called with
   `{ outputs: {...} }`. A `jm_human_task_resolutions` row is written with
   `source = "manual"`. Conductor is signalled to continue.
5. If timeout fires before resolution: resolution row written with
   `source = "timeout"`, outputs filled from `timeout.defaults`.

### Output artifact

Same shape as today:

```ts
type HumanTaskOutput = {
  source: "manual" | "timeout";  // "webhook" no longer applies here
  actor: string | null;
  resolvedAt: string;
  payload: Record<string, unknown>;  // { ...form values } for manual; {} for timeout
} & Record<string, unknown>;          // declared fields spread at top level
```

Downstream nodes reference `humanTask1.<fieldName>` and meta keys
`humanTask1.source`, `.actor`, `.resolvedAt`.

## Webhook Wait — new node

### Author experience

A Webhook Wait node's config panel shows:

- **Provider** — `jira` | `github` | `gitlab` | `monday` | `linear` | `api`.
- **Listens for** — event type allowlist (empty = any event type from provider).
- **Accept-if** *(optional)* — JSONLogic predicate evaluated on payload. Same
  language used by If-Else gateways.
- **Correlation key** — how this paused node binds to incoming events. Initially
  `issueRef` (Jira issue key, GitHub issue/PR number, etc.) since that's already
  the working path. Extensible later.
- **Outputs** — declared fields, each with `name`, `type`, optional `fromPath`
  (dot-path into the webhook payload). Required fields with no `fromPath` and
  no payload-derived value fail the resolution attempt.
- **Timeout** *(optional)* — `duration` plus `defaults`, identical semantics to
  Human Task's timeout.

### Runtime flow

1. Workflow reaches the node → Conductor pauses. Correlation key (e.g. `issueRef`)
   is recorded on the workflow instance.
2. Event arrives at `POST /webhooks/:provider`.
3. Router (current code in `packages/api-server/src/routes/webhooks.ts`):
   a. Find paused `webhook-wait` nodes whose correlation key matches and whose
      `listensFor` includes this event type.
   b. For each candidate, evaluate `acceptIf`. First match wins.
   c. Extract declared outputs via `fromPath`. Write resolution row with
      `source = "webhook"` and `webhook_event_id` populated. Resume Conductor.
   d. If no waiter matches → fall through to existing "start new workflow" rules.
4. Timeout path identical to Human Task.

### Output artifact

```ts
type WebhookWaitOutput = {
  source: "webhook" | "timeout";
  resolvedAt: string;
  webhookEventId: string | null;        // null on timeout
  payload: Record<string, unknown>;     // raw webhook body
} & Record<string, unknown>;             // declared fields spread at top level
```

## Shared infrastructure (no change)

Both node types reuse what's already built:

- Conductor `HUMAN_TASK` task as the underlying pause primitive
  (`packages/orchestrator/src/flow-json/conductor-types.ts`,
  `flow-json/conductor-converter.ts`).
- `IHumanTaskResolutionStore` and `IWebhookEventStore`
  (`packages/orchestrator/src/stores/`). The resolution row's `source` column
  already supports `"webhook" | "manual" | "timeout"`.
- `InMemoryHumanTaskTimeoutService` for timeout firing.
- `POST /webhooks/:provider` ingest endpoint and its match-then-trigger router.

The split is purely at the **node-type + editor** layer plus a small renaming of
backend services (see Code structure below). The DB schema is unchanged.

## Migration of existing nodes

Existing `human-task` nodes fall into two buckets:

1. **No `listensFor` and no `acceptIf` set** → already a pure human task. Stays as
   `human-task`. No-op.
2. **Has `listensFor` or `acceptIf` set** → auto-converted to `webhook-wait` on
   workflow load. The `outputs[].fromPath` fields, `listensFor`, and `acceptIf`
   move over verbatim. `prompt` is dropped (webhook-wait has no prompt).

Migration runs in the workflow loader (`packages/orchestrator/src/flow-json/` or
the API server's workflow read path — exact location TBD during planning). It is
read-time only: stored definitions are not rewritten until the workflow is next
saved/published. Editor displays the converted node so the author sees the new
shape immediately.

Workflow instances already in flight at deploy time are unaffected — Conductor
operates on the snapshotted definition stored on the instance.

## Code structure changes

### Types (`@journeyman/core`)

- `human-task.types.ts` — slim down `HumanTaskConfig` to: `prompt`, `outputs`
  (without `fromPath`), `notify?`, `timeout?`. Remove `listensFor`, `acceptIf`.
  Drop `"webhook"` from `HumanTaskSource` (now `"manual" | "timeout"`).
- New `webhook-wait.types.ts` — `WebhookWaitConfig` with the moved fields plus
  `provider`, `correlationKey`. `WebhookWaitOutput` type.

### Editor (`@journeyman/flow-editor`)

- Split `ControlNodeConfigTab.tsx`'s `HumanTaskConfigEditor` into:
  - `HumanTaskConfigEditor` — only Question / Fields / Notify / Timeout.
  - New `WebhookWaitConfigEditor` — Provider / Listens for / Accept-if /
    Correlation key / Outputs (with `fromPath`) / Timeout. Inherits the existing
    `AcceptIfBuilder`.
- New `WebhookWaitNode` canvas component (mirror of `HumanTaskNode`).
- `node-registry.ts` — register `"webhook-wait"`.
- `palette/built-in-categories.ts` — add Webhook Wait alongside Human Task.

### Backend

- `packages/orchestrator/src/flow-json/conductor-converter.ts` — add
  `emitWebhookWait` (very close to `emitHumanTask`).
- `packages/api-server/src/routes/webhooks.ts` — generalize
  `matchAndResolveHumanTasks` to `matchAndResolveWaiters`, dispatching on the
  paused node's type (`human-task` rejects webhook resolution; `webhook-wait`
  accepts).
- `packages/api-server/src/routes/human-tasks.ts` — unchanged endpoint contract;
  guard so it only resolves `human-task` nodes (not `webhook-wait`).
- Notification dispatch on human-task pause: new tiny service that subscribes
  to the engine's "node entered waiting" emission and sends via
  `INotificationProvider` per the node's `notify` config. Logged-only failures.

### Loader migration

- Centralize the read-time `human-task` → `webhook-wait` conversion in one
  function (call site TBD: orchestrator or api-server, see planning step). Cover
  it with focused unit tests on representative legacy configs.

## Testing strategy

- **Type / config** — unit tests on the migration function: every legacy shape
  maps cleanly; pure human-task configs are untouched.
- **Editor** — component tests confirming the human-task panel no longer renders
  webhook fields; webhook-wait panel renders them correctly.
- **Engine** — integration test: a workflow with one human-task + one
  webhook-wait pauses at each, resolves each via its respective path, and the
  artifacts surface correctly to downstream nodes.
- **Webhook router** — existing `matchAndResolveHumanTasks` tests adapted;
  add cases where a paused `human-task` does *not* resolve on webhook (only
  `webhook-wait` does).
- **Timeout** — both node types fire timeout with declared defaults; resolution
  row has `source = "timeout"`.

## Open questions (resolve during planning)

1. **Correlation key vocabulary for `webhook-wait`**: start with `issueRef` only,
   or also expose a generic "JSONLogic on payload" correlation mode in v1? Default
   to `issueRef`-only for v1 to ship faster.
2. **Notification provider routing for human-task notify**: reuse existing
   `INotificationProvider` (Slack/console), or introduce a dedicated channel
   abstraction? Reuse existing in v1.
3. **Where the migration function lives**: orchestrator workflow loader vs
   api-server flow read path. Whichever surface ALL flow reads pass through.

## Acceptance criteria

- Authoring a Human Task shows only Question / Fields / Notify / Timeout — no
  webhook fields visible.
- Authoring a Webhook Wait shows only the system-event config — no Question /
  Notify.
- A workflow with both nodes runs end-to-end: human-task resolved via the app's
  resolve endpoint, webhook-wait resolved via `POST /webhooks/:provider`.
- Existing workflows that had `listensFor`/`acceptIf` on a `human-task` load
  correctly as `webhook-wait` with no manual intervention.
- Notification on human-task pause delivers a Slack DM (or email) with a link
  to the resolve page when configured; delivery failure does not fail the run.
- All existing `human-task` integration tests pass, adapted as needed.
