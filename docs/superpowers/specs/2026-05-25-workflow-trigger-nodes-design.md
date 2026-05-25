# Workflow Trigger Nodes — Design

**Date:** 2026-05-25
**Status:** Draft — pending implementation plan

## Problem

Today every workflow starts the same way: a single `start` node, fired by the **Run** button (`POST /workflows/:id/workflow-instances`) with an `inputs` body. There is no path for an inbound event — a GitHub webhook, a human form submission — to *start* a workflow instance. Existing `webhook-wait` / `human-task` nodes only **resume** instances that are already running.

We want a workflow to be startable by **any of**: manual run, incoming webhook, or human form — and a single workflow may declare more than one of these.

## Goals

- Replace the single `start` node with a category of **trigger** nodes.
- Support three triggers in v1: `trigger-manual`, `trigger-webhook`, `trigger-human`.
- Allow a workflow to declare ≥1 trigger; any one fires → a new instance.
- Preserve today's Run button behaviour with zero user-visible regressions.
- Keep `webhook-wait` and `human-task` semantically unchanged (they pause instances mid-flow).
- Define a clear precedence so a webhook does not accidentally both resume an in-flight instance *and* start a new one.

## Non-goals

- Scheduled / cron triggers (out of scope; reserved type for a later spec).
- Public, unauthenticated form URLs for `trigger-human` (form submission is in-app only).
- Trigger fan-out where one webhook event starts the same workflow multiple times in parallel.
- Cross-workflow trigger composition (a workflow firing another).

## Background — what exists today

- `WorkflowNodeType` includes `start`, plus `webhook-wait` and `human-task` (used mid-flow). See [packages/core/src/types/flow.types.ts:12](packages/core/src/types/flow.types.ts:12).
- Run button → `POST /workflows/:id/workflow-instances` → `c.orchestrator.submit({...inputs})`. See [packages/api-server/src/routes/flows.ts:608](packages/api-server/src/routes/flows.ts:608).
- Webhook ingest → `POST /webhooks/in/:tenantToken` → `ingestForWebhook` → `matchAndResolveWebhookWaits` (resumes paused instances only, matched by `issueRef`). See [packages/api-server/src/services/webhook-ingest.ts](packages/api-server/src/services/webhook-ingest.ts) and [packages/api-server/src/services/match-human-tasks.ts](packages/api-server/src/services/match-human-tasks.ts).
- `Webhook` records are first-class entities (user/org scoped, with auth, schema, presets). See [packages/core/src/types/webhook.types.ts](packages/core/src/types/webhook.types.ts).
- Validation enforces "exactly one `start` node" in [packages/core/src/validation/validate-for-publish.ts:83](packages/core/src/validation/validate-for-publish.ts:83).

## Design

### Node model

`WorkflowNodeType` gains three trigger types and removes `start`:

| Type | Purpose | Fires on |
|---|---|---|
| `trigger-manual` | Today's manual Run. | `POST /workflows/:id/workflow-instances` |
| `trigger-webhook` | Inbound webhook starts a new instance. | Matching event arrives at `POST /webhooks/in/:tenantToken` and no paused instance was resumed. |
| `trigger-human` | In-app form submission starts a new instance. | `POST /workflows/:id/form-submissions` |

A workflow declares ≥1 trigger nodes. All triggers feed the same downstream graph and the same workflow-level `inputs` schema.

### Workflow inputs are lifted to the workflow level

Today `WorkflowInputDef[]` is conventionally attached to the `start` node. Because all triggers must share a single input shape, inputs become a top-level property:

```ts
WorkflowGraph {
  schemaVersion: 2,
  inputs: WorkflowInputDef[],     // moved off start; single source of truth
  nodes: WorkflowNode[],           // includes ≥1 trigger-* node
  edges: WorkflowEdge[],
}
```

Each trigger declares *how its source data maps onto those inputs*:

```ts
trigger-manual.config  = {} // none; form is auto-rendered from workflow.inputs

trigger-webhook.config = {
  webhookId: string,                              // FK → jm_webhooks.id
  listensFor?: string[],                          // optional event-type whitelist
  acceptIf?: JsonLogicExpr,                       // optional JSONLogic filter on payload
  inputsMapping: {
    [inputName]: {
      fromPath: string,                           // JSONPath into rawPayload
      type: "string" | "number" | "boolean" | "json",
    }
  },
  issueRefFromPath?: string,                      // optional: set instance.issueRef
}

trigger-human.config = {
  formTitle?: string,
  fieldOverrides?: Record<string, {
    label?: string;
    description?: string;
    widget?: "text" | "textarea" | "number" | "checkbox" | "select";
    options?: string[];
  }>,
  authorizedRoles?: string[],                     // who can see/submit; defaults to workflow scope
}
```

Instance records gain a `triggeredBy` discriminator:

```ts
triggeredBy: {
  kind: "manual" | "webhook" | "human";
  triggerNodeId: string;
  webhookId?: string;        // when kind === "webhook"
  eventId?: string;          // when kind === "webhook"
  formSubmissionId?: string; // when kind === "human"
}
```

### Webhook ingest flow (resume-wins precedence)

```
POST /webhooks/in/:tenantToken
  │
  ├─ 1. Auth + schema (unchanged)
  │
  ├─ 2. matchAndResolveWebhookWaits(event)     ← unchanged; resume paused instances
  │     │
  │     ├─ matched ≥ 1 → respond { resolved, matched } and STOP
  │     │
  │     └─ matched 0   → continue
  │
  ├─ 3. findActiveTriggers(webhookId)           ← new index lookup
  │     for each trigger-webhook node bound to this webhookId
  │     in a published-and-current workflow version:
  │       if (listensFor passes) and (acceptIf passes):
  │         inputs    = mapPayload(event.rawPayload, node.config.inputsMapping)
  │         issueRef  = node.config.issueRefFromPath ? extract(...) : null
  │         orchestrator.submit({
  │           workflowId, workflowVersionId, definitionSnapshot,
  │           inputs, issueRef,
  │           triggeredBy: { kind: "webhook", triggerNodeId, webhookId, eventId }
  │         })
  │
  └─ 4. If no trigger fired → event status = "ignored"
```

**Rationale for resume-wins:** events about an in-flight thing belong to that thing. Spinning up a parallel run on the same `issueRef` is almost always a bug. If a user wants true fan-out, they create a *second* webhook (different `tenantToken`) bound only to the trigger.

### Trigger index table

To avoid scanning every workflow definition on every webhook event, a denormalized index is maintained:

```sql
-- packages/migrations/src/sql/028_workflow_triggers.sql
CREATE TABLE jm_workflow_triggers (
  id                  uuid PRIMARY KEY,
  workflow_id         uuid NOT NULL REFERENCES jm_workflows(id) ON DELETE CASCADE,
  workflow_version_id uuid NOT NULL REFERENCES jm_workflow_versions(id) ON DELETE CASCADE,
  trigger_node_id     text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('manual','webhook','human')),
  webhook_id          uuid NULL REFERENCES jm_webhooks(id) ON DELETE SET NULL,
  is_active           boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_version_id, trigger_node_id)
);

CREATE INDEX idx_jm_workflow_triggers_webhook_active
  ON jm_workflow_triggers (webhook_id)
  WHERE is_active = true AND kind = 'webhook';
```

`is_active` is set to `true` only for the row whose `workflow_version_id = workflow.currentVersionId` AND `workflow.status = 'ready'`. The index is refreshed on **publish**, **unpublish**, and **promote-new-version** transitions in [packages/api-server/src/routes/flows.ts](packages/api-server/src/routes/flows.ts).

### Editor UX

The flow editor canvas gains a **Triggers lane** above the regular graph. The lane contains the workflow's trigger nodes side by side; each is auto-wired to the entry point of the downstream graph.

```
┌─ Triggers ─────────────────────────────────────────────┐
│   [ + Add trigger ]                                    │
│   ┌──────────────┐   ┌──────────────┐                  │
│   │ ▶ Manual     │   │ 🪝 Webhook   │                  │
│   │   "Run"      │   │  GitHub PRs  │                  │
│   └──────┬───────┘   └──────┬───────┘                  │
└──────────┼──────────────────┼──────────────────────────┘
           └────────┬─────────┘
                    ▼
              ┌──────────────┐
              │ first step   │
              └──────────────┘
```

**Add-trigger flow:**

1. `+ Add trigger` opens a modal with three tiles: **Manual run** · **Webhook** · **Human form**.
2. Selection creates the node in the lane, auto-wired to the existing entry node.
3. Properties panel opens for configuration:
   - **Manual** — no config; shows a preview of the auto-generated form from `workflow.inputs`.
   - **Webhook** — dropdown of webhooks in scope (via `GET /webhooks`), plus "Create new webhook" shortcut. Fields: `listensFor`, `acceptIf` (JSONLogic builder), `inputsMapping` (one row per workflow input with a JSONPath picker assisted by the webhook's `payloadSchema` if present), optional `issueRefFromPath`.
   - **Human form** — `formTitle`, optional per-input `fieldOverrides`, `authorizedRoles`.

**Workflow inputs editor** moves from the start-node properties panel to a top-level **Inputs** tab on the workflow page. Each trigger references those inputs by name.

**Removing the last trigger** is allowed in draft but blocks publish (validation error "workflow needs at least one trigger").

### Validation rules

| Old | New |
|---|---|
| Exactly one `start` node | At least one `trigger-*` node |
| `start` is the unique graph source | All `trigger-*` nodes are graph sources (no inbound edges) |
| `start` has no `stepType` | Same for trigger nodes |
| (n/a) | Every non-trigger node is reachable from at least one trigger (no orphan subgraphs). Triggers may share or diverge into downstream paths — they are not required to converge on a single first node. |
| (n/a) | `trigger-webhook.config.webhookId` must reference a webhook visible in the workflow's scope at publish time |
| (n/a) | `trigger-webhook.inputsMapping` must cover every `required: true` workflow input |
| (n/a) | `trigger-human.fieldOverrides` keys must be valid input names |

### API surface

| Endpoint | Change |
|---|---|
| `POST /workflows/:id/workflow-instances` | **Unchanged contract.** Semantically now means "fire `trigger-manual`". Returns `409 no_manual_trigger` if the workflow has no `trigger-manual`. |
| `POST /webhooks/in/:tenantToken` | **Extended.** After `matchAndResolveWebhookWaits` returns `matched: 0`, evaluates `trigger-webhook` rows from `jm_workflow_triggers` and calls `orchestrator.submit` per match. |
| `GET /me/forms` | **New.** Returns published workflows with a `trigger-human` node visible to the caller — used by the in-app "Start a workflow" inventory page. |
| `GET /workflows/:id/form` | **New.** Returns the resolved form schema (`workflow.inputs` merged with `trigger-human.fieldOverrides`) for rendering. |
| `POST /workflows/:id/form-submissions` | **New.** Authorizes caller against `trigger-human.authorizedRoles` (defaults to workflow read scope), validates submission against `workflow.inputs`, calls `orchestrator.submit` with `triggeredBy.kind = "human"`. |
| `GET /workflows/:id/triggers` | **New.** Returns a trigger summary for the workflow detail header ("Triggered by: Manual, Webhook (GitHub PRs)"). |

### Migration

One-shot, executed when this ships:

- For every workflow draft and published version:
  - Lift `start.inputs` → `workflow.inputs` (defaults to `[]` if absent).
  - Convert the `start` node → `trigger-manual` node with the same `id` and `position`, no `config`.
  - Edges originating from `start` keep their source id (since we reuse the id).
- `WORKFLOW_SCHEMA_VERSION` bumps from `1` → `2`. The Conductor JSON converter ([packages/orchestrator/src/flow-json/conductor-converter.ts](packages/orchestrator/src/flow-json/conductor-converter.ts)) handles read-time migration for any v1 JSON still in flight.
- Validation rules update atomically with the migration.

No user action required.

## Affected packages

| Package | Change |
|---|---|
| `@journeyman/core` | `WorkflowNodeType` adds `trigger-manual` / `trigger-webhook` / `trigger-human`, removes `start`. New config types. `WorkflowGraph.inputs` lifted. `triggeredBy` on instance. `WORKFLOW_SCHEMA_VERSION` → 2. |
| `@journeyman/migrations` | `028_workflow_triggers.sql`; in-place transform of existing workflow JSON. |
| `@journeyman/api-server` | Extend `webhook-ingest` with the trigger branch; new `forms` / `form-submissions` routes; new `triggers` route; update `flows.ts` publish flow to maintain `jm_workflow_triggers`. |
| `@journeyman/orchestrator` | Accept `triggeredBy` in `submit`. Update `conductor-converter.ts` for v1→v2 read-time migration. Validation in `flow-json/validate-ref-shape.ts` and `reachability.ts` updated. |
| `@journeyman/flow-editor` | Triggers lane component; "Add trigger" modal; properties panels for each trigger type; workflow-level Inputs tab. |
| `@journeyman/web` | New routes: in-app forms inventory (`/forms`), form rendering page (`/workflows/:id/form`). Workflow detail header shows trigger summary. |

## Risks

- **Trigger index drift.** If `jm_workflow_triggers` falls out of sync with the workflow JSON, webhook events silently fail to start instances. Mitigation: index is rebuilt on every publish/unpublish/promote; add a one-shot reconciliation job and tests covering each transition.
- **Schema v1 → v2 migration on in-flight workflow JSON.** Conductor may have stored snapshots still using `start`. Mitigation: `conductor-converter` does read-time migration; we never write v1 again.
- **Webhook visibility / permission boundary.** A user binding a `trigger-webhook` to a webhook outside their scope must be rejected at publish time, not silently allowed and rejected at fire time. Mitigation: validation rule + integration test.
- **Resume-vs-trigger ambiguity in mixed environments.** If a webhook is used both for resuming `webhook-wait` AND for starting via `trigger-webhook`, users may be confused why "the same event" sometimes starts and sometimes resumes. Mitigation: document precedence in the trigger-webhook properties panel.

## Testing

- Unit: trigger validation rules; `inputsMapping` evaluation; v1→v2 converter; index refresh on publish lifecycle.
- Integration:
  - Manual trigger preserves today's Run behaviour (regression suite).
  - Webhook event arrives, no paused instance → trigger fires → instance starts with mapped inputs and correct `triggeredBy`.
  - Webhook event arrives, paused instance exists → only resume; trigger does not fire.
  - Human form submission validates against inputs; rejects bad payloads with `400`; happy path starts instance.
  - Publish blocked when no trigger present.
  - Publish blocked when `trigger-webhook.webhookId` is out of scope.
- E2E (web): Add-trigger flow in editor; in-app forms inventory; trigger summary on workflow detail.

## Open questions

None at design time. Implementation plan will surface details (exact JSONPath library, form widget catalogue completeness, etc.).
