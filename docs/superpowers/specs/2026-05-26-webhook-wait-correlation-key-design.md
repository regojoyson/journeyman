# Webhook-Wait Correlation Key — Design

**Date:** 2026-05-26
**Status:** Draft
**Scope:** `webhook-wait` node, webhook ingest matcher, removal of instance-level `issueRef`

## Problem

Today the system uses an instance-level field `issueRef` (configured on `trigger-webhook` via `issueRefFromPath`) to correlate later webhook events with paused workflow instances. This design has three problems:

1. **The dedicated field is half-wired.** `submit({ issueRef })` is passed in TypeScript but the Postgres `create()` INSERT in [postgres-workflow-instance-store.ts](packages/orchestrator/src/stores/postgres/postgres-workflow-instance-store.ts) does not write any `issue_ref` column. The lookup queries (`findActiveInstancesByIssueRef`, `findPausedInstancesByIssueRef`) read `inputs->>'issueRef'` instead. So the configured value is silently dropped, and only an input named `issueRef` actually drives matching.

2. **Two configuration paths for the same thing.** A user can either (a) set `IssueRef from path` on the trigger, or (b) add an input mapping named `issueRef`. Only (b) works. The UI exposes both with no indication of which is real.

3. **The abstraction is wrong.** A correlation key on the *instance* must be meaningful for every wait in the workflow. But a wait might want to correlate on something the trigger never saw (e.g. a PR number created by an intermediate step). And the same workflow can run many times for the same external thing — `correlationKey` is a many-to-one tag, not an identifier of the instance.

## Design

Move correlation from the instance to the **paused wait** itself. Each `webhook-wait` node carries its own routing predicate. No instance-level correlation field.

### Node config shape

`webhook-wait` gains a `correlationKey` field alongside today's `acceptIf`:

```ts
interface WebhookWaitConfig {
  listensFor?: string[];                    // existing — event-type whitelist
  correlationKey?: {                        // NEW — routing
    eventPath: string;                      // JSONPath into the incoming event payload
    value: string;                          // template, e.g. "{{ outputs.createPR.prNumber }}"
  };
  acceptIf?: JsonLogic;                     // existing — additional filter on the event
  outputs?: WebhookWaitOutputField[];       // existing — what to extract on resume
  timeout?: string;                         // existing
}
```

The split is deliberate:

- **`correlationKey`** answers "which instance does this event belong to?" — a single comparable value, indexable.
- **`acceptIf`** answers "is this the kind of event I care about?" — a free-form predicate, no template references needed.

### Runtime — pause

When the workflow reaches a `webhook-wait` node:

1. Engine resolves the `correlationKey.value` template against current instance state. Example: `"{{ outputs.createPR.prNumber }}"` → `"4271"`.
2. Engine stores on the paused node-execution row:
   - `correlation_event_path` (string) — copied verbatim from config
   - `correlation_value` (string) — the resolved value
3. Conductor pauses on the node as today.

The template is resolved *once at pause time*. The snapshot avoids races and makes the match a pure value comparison.

### Runtime — event arrives

`webhook-ingest` for each incoming event:

1. Build an `event_type` (provider + event kind), same as today.
2. Query: paused `webhook-wait` executions where `listensFor` contains the event type AND `correlation_value = readPath(event.payload, correlation_event_path)`.
   - Note: `correlation_event_path` varies per wait, so the query is structured as: pull candidates by `event_type` index, then in code filter by `extract(payload, exec.correlation_event_path) === exec.correlation_value`.
   - Optimisation (later, if needed): bucket paused waits by `(event_type, correlation_event_path)` so multiple waits sharing the same path become one indexed lookup.
3. For each candidate, evaluate `acceptIf` against the event payload. Discard non-matches.
4. For each survivor, extract declared `outputs` from the payload and resume the workflow via `resolveHumanTask` (existing path).

### Schema changes

`jm_node_executions` (or wherever paused-wait state lives — to be confirmed in the plan):

```sql
ALTER TABLE jm_node_executions
  ADD COLUMN correlation_event_path TEXT,
  ADD COLUMN correlation_value      TEXT;

CREATE INDEX jm_node_executions_correlation_idx
  ON jm_node_executions (correlation_value)
  WHERE status = 'waiting';
```

`jm_workflow_instances`:

- **Remove** any reads of `inputs->>'issueRef'`. The column itself never existed; no schema change required.
- `findActiveInstancesByIssueRef` / `findPausedInstancesByIssueRef` — **deleted**. No callers remain after the matcher switch.

### Removals

- `WorkflowGraph` trigger config: `issueRefFromPath` — removed.
- `SubmitWorkflowInstanceArgs.issueRef` — removed.
- `IWorkflowInstanceStore.findActiveInstancesByIssueRef` / `findPausedInstancesByIssueRef` — removed.
- `webhook-trigger-fire.ts` `issueRef` extraction block (lines 70-86) — removed.
- Conductor converter `correlationKey: cfg.correlationKey ?? "issueRef"` — re-purposed (see below).
- Properties panel: `IssueRef from path (optional)` field on `trigger-webhook` — removed.

### Conductor-side correlation

The Conductor adapter today emits `correlationKey: "issueRef"` per task. That value is meaningless now (the column it references doesn't exist). Drop the `correlationKey` field from the emitted Conductor task definition. If Conductor's own correlation features become useful later, revisit then.

### UI

Properties panel for `webhook-wait` gains a clearly-labelled section:

```
┌─ Correlation ──────────────────────────────────────┐
│  Match this event to the paused workflow by:      │
│                                                    │
│  Event path     [ $.pull_request.number    ]      │
│  Equals         [ {{ outputs.createPR.prNumber }} ]│
└────────────────────────────────────────────────────┘

┌─ Accept if (optional) ─────────────────────────────┐
│  [existing JSONLogic editor]                       │
└────────────────────────────────────────────────────┘
```

Properties panel for `trigger-webhook`: the `IssueRef from path (optional)` field is removed. No replacement — triggers never needed correlation.

### Validation (publish-time)

Publish validation rejects a workflow that contains a `webhook-wait` node without a `correlationKey.eventPath` and `correlationKey.value`. (Empty correlation is meaningless — every event would match every wait.)

### Migration of existing workflows

Existing workflows in the database may have:

- `trigger-webhook` nodes with `config.issueRefFromPath` set.
- `webhook-wait` nodes that implicitly depended on `inputs.issueRef` matching.

Migration strategy is **load-time strip + manual reconfiguration**, mirroring the existing `config.mcp` legacy pattern:

1. At workflow-graph load, drop `issueRefFromPath` from any `trigger-webhook` node config.
2. `webhook-wait` nodes with no `correlationKey` produce a publish-time validation error after the change ships.
3. Provide a one-time documentation note in the changelog: "If your workflow used `issueRef` to correlate webhook events, configure `correlationKey` on each `webhook-wait` node."

No automatic data migration — there isn't enough information in the old config to synthesise a correct `correlationKey` (the `eventPath` for the *resuming* event is not the same as the `issueRefFromPath` for the *triggering* event).

## Out of scope

- Cross-instance views ("show me all runs for PROJ-123"). If we want this later, add an optional `tags: string[]` field on the instance purely for search. Not part of this change.
- Dedupe ("don't start a second instance if one is running for PROJ-123"). Separate feature.
- Trigger-time correlation. Triggers fire-and-forget; no correlation needed.

## Testing

- Unit: pause-time template resolution snapshots correctly.
- Unit: matcher returns expected candidates for a synthetic event payload.
- Integration: end-to-end workflow that pauses on `webhook-wait`, receives a matching event, resumes with extracted outputs.
- Integration: matching event arrives for a wait whose `acceptIf` rejects — instance stays paused.
- Integration: non-matching `correlation_value` — instance stays paused.
- Migration test: workflow with legacy `issueRefFromPath` loads cleanly (field is stripped) and fails publish validation if `correlationKey` is missing on a `webhook-wait`.

## Open questions

None blocking. The structural choice (`{ eventPath, value }` over a generic JSONLogic predicate) is deliberate — it preserves an indexable lookup. If a future use case needs richer matching, add a second optional predicate field; don't merge into `correlationKey`.
