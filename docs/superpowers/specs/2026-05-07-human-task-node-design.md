# Human-Task Node — Design Spec

**Date:** 2026-05-07
**Status:** Draft for review
**Scope:** Introduce a first-class `human-task` flow node that pauses a run, exposes pending state to humans, and resumes when an outcome is supplied — either by a provider webhook (Jira / GitHub / GitLab / Monday) or by an internal in-app form.

---

## 1. Motivation

Flows today run end-to-end autonomously. Real development workflows need **human gates** between automated steps:

- After `analyze` — a reviewer corrects scope before planning.
- After `plan` — a reviewer approves or requests changes.
- After `implement` (or `create-PR`) — a reviewer approves the code or asks for changes.

When changes are requested, the AI re-runs the affected phase using the reviewer's feedback as input, and the loop continues until the reviewer approves (or a cycle limit is hit).

The flow data model already reserves a `human-task` node type (`packages/core/src/types/flow.types.ts:26`); the engine currently rejects it with `UnsupportedNodeTypeError`. This spec turns that into a working node.

A previous iteration on this idea — [`2026-04-20-human-review-loop-design.md`](2026-04-20-human-review-loop-design.md) — was scoped to the older pipeline architecture and is superseded by this spec.

---

## 2. Design Goals

1. **First-class node, not a phase.** Human-task is a flow-graph node, expressed on the canvas like any other tile.
2. **Outcome-driven branching.** A human-task is essentially a human-controlled xor-gateway: outcome label decides which outgoing edge to follow.
3. **Webhook-primary, manual fallback.** Resolution comes from provider webhooks correlated by `issueRef`. An in-app form synthesizes the same internal call for cases where no webhook fires.
4. **Pure graph-driven loops.** Rework loops are just edges that point back at an upstream node — no compound nodes, no special engine concepts. Bounded by the existing `maxCycleVisits`.
5. **Single resolve path.** Webhook, in-app form, and timeout all funnel into one internal `resolveHumanTask` function.

---

## 3. Node Model

### 3.1 Config shape

```ts
interface HumanTaskConfig {
  /** Free-form outcome labels. Outgoing edges' branchLabel must be a subset. */
  outcomes: string[];                // e.g. ["approve", "request-changes", "abandon"]

  /** Shown to the human in the UI / notification. */
  prompt?: string;

  /** Provider event filter — only events matching these types resolve the task. */
  listensFor?: string[];             // e.g. ["jira.issue_updated", "github.pull_request.review"]

  /** Per-provider mapping payload → outcome. */
  outcomeMap?: Record<
    string,                          // provider name ("jira" | "github" | "gitlab" | "monday")
    {
      /** JSONPath into payload that yields the raw value to map. */
      valuePath: string;             // e.g. "issue.fields.status.name"
      /** Mapping from raw value → declared outcome. */
      map: Record<string, string>;   // e.g. { "Approved": "approve", "Changes Requested": "request-changes" }
      /** JSONPath into payload yielding the optional comment text. */
      commentPath?: string;          // e.g. "comment.body"
    }
  >;

  /** Optional auto-resolve. Off by default. */
  timeout?: { duration: string; onTimeout: string };  // duration is human ("48h", "7d")
}
```

### 3.2 Outputs

When the node resolves, it emits the following artifact (consumable downstream via `inputs: { x: { kind: "ref", ref: "humanTask1.<key>" } }`):

```ts
{
  outcome: string;        // one of the declared outcomes
  comment: string | null;
  actor: string | null;   // resolver identity (webhook user id or in-app user id)
  source: "webhook" | "manual" | "timeout";
  resolvedAt: string;     // ISO-8601
}
```

### 3.3 Editor validation

- Every outgoing edge's `branchLabel` must match one of `outcomes`.
- Every outcome must have at least one outgoing edge (no dead outcomes).
- If `timeout` is set, `onTimeout` must be one of `outcomes`.
- If any outgoing edge loops back to an upstream node, `FlowGraph.maxCycleVisits` must be > 0.

### 3.4 Example

```
implement → human-task ──approve──→ create-PR
                  │
                  └──request-changes──→ implement (loops back, reads humanTask1.comment)
```

```yaml
nodes:
  - id: humanTask1
    type: human-task
    displayName: "Code review gate"
    config:
      prompt: "Review the implementation. Approve to ship, or request changes."
      outcomes: ["approve", "request-changes"]
      listensFor: ["jira.issue_updated"]
      outcomeMap:
        jira:
          valuePath: "issue.fields.status.name"
          map:
            "Approved": "approve"
            "Changes Requested": "request-changes"
          commentPath: "comment.body"

  - id: implement1
    type: phase
    phaseType: implement
    inputs:
      reviewComments: { kind: "ref", ref: "humanTask1.comment" }

edges:
  - { source: humanTask1, target: createPR1, type: conditional, branchLabel: "approve" }
  - { source: humanTask1, target: implement1, type: conditional, branchLabel: "request-changes" }
```

---

## 4. Engine Behavior

### 4.1 Reaching the node

When the runner encounters a `human-task` node:

1. Create a `NodeExecution` row with status `"waiting"` (new enum value).
2. Transition `Run.status` from `running` → `paused`.
3. Emit a `node.waiting` run event (new event type) with `{ nodeId, prompt, outcomes, listensFor }`.
4. If `config.timeout` is set, schedule a one-shot timer (engine-side, alongside existing retry timers).
5. The runner yields. No further work on this run until resume.

### 4.2 Resolving the node

Single internal function — the only entry point that mutates a waiting human-task:

```ts
resolveHumanTask(runId, nodeId, {
  outcome: string;
  comment: string | null;
  actor: string | null;
  source: "webhook" | "manual" | "timeout";
  webhookEventId?: string;
}): Promise<void>
```

Steps:

1. Validate `outcome` is in the node's declared `outcomes` (else 400).
2. Assert the node execution is currently `waiting` (else 409 — already resolved or run cancelled).
3. Cancel the timeout timer if scheduled.
4. Insert a `jm_human_task_resolutions` row.
5. Write the node's output artifact `{ outcome, comment, actor, source, resolvedAt }` and mark the execution `completed`.
6. Emit `node.resolved` run event.
7. Transition `Run.status` from `paused` → `running` and re-queue the run; the engine picks the outgoing edge whose `branchLabel === outcome` and continues.

### 4.3 Three callers

- **Provider webhook receiver** — after correlation + outcome extraction.
- **In-app manual-resolve endpoint** — `POST /runs/:runId/human-tasks/:nodeId/resolve`.
- **Timeout timer firing** — `source: "timeout"`, `outcome: config.timeout.onTimeout`.

No new resume primitive: the human-task is just a node that decides when to stop being `waiting`.

---

## 5. Webhook Routing

The existing `POST /webhooks/:provider` (`packages/api-server/src/routes/webhooks.ts:25`) already extracts `issueRef` + `eventType` and writes a `jm_webhook_events` row. We extend its routing to add a "resolve-pending-task" branch **before** the new-run branch:

```
on webhook event:
  1. Find runs where:
       - status = "paused"
       - latest waiting NodeExecution is on a "human-task" node
       - run inputs / definitionSnapshot expose issueRef matching event.issueRef
  2. For each candidate run, load the node config:
       - if event.eventType is in listensFor → continue, else skip
       - apply outcomeMap[event.provider]:
           rawValue = JSONPath(payload, valuePath)
           outcome  = map[rawValue]
           if outcome is undefined → record event, leave run paused
       - extract comment via commentPath (if present)
       - call resolveHumanTask(...)
  3. If no pending human-task matched → fall through to existing new-run path
```

**Multiple matches.** If two paused runs match the same event (concurrent runs on the same `issueRef`), all are resolved. Each run owns its own state.

**Audit.** The `jm_human_task_resolutions` row links to `jm_webhook_events.id` for full traceability.

**HMAC verification is out of scope for this spec** (see §8). v1 accepts webhooks unsigned, with audit logging.

---

## 6. UI / Editor

### 6.1 Palette & canvas

- New `human-task` tile in the palette under a "Gates" group (alongside if/else and xor-gateway).
- On the canvas, `waiting` nodes render distinctly: pulsing border, hourglass icon, "waiting for human" subtext.
- Outgoing edges from a `human-task` node take their `branchLabel` from the outcome list via a dropdown picker (not free-form text) populated from `config.outcomes`.

### 6.2 Properties panel (config tab)

- **Prompt** (textarea) — what the human sees.
- **Outcomes** (chip editor) — add/remove outcome labels.
- **Listens for** (multi-select of provider event types).
- **Outcome map** (per-provider table editor): provider | valuePath | rawValue → outcome rows | commentPath.
- **Timeout** (collapsible): duration + onTimeout dropdown (populated from declared outcomes).

### 6.3 Run detail page

- Waiting node tile is highlighted and clickable.
- Side panel shows: prompt, declared outcomes, when waiting started, timeout countdown if any.
- "Resolve manually" form: outcome picker + optional comment textarea + submit. Posts to `/runs/:runId/human-tasks/:nodeId/resolve`.
- Resolution history: actor, source (`webhook` / `manual` / `timeout`), comment, timestamp.

### 6.4 Run list

- Filter chip: "Waiting on humans" — selects all `paused` runs whose latest node execution is `waiting` on a `human-task`.

---

## 7. Data Model Changes

### 7.1 Type changes (`packages/core/src/types/`)

- `flow.types.ts`: keep `human-task` in the `FlowNodeType` union; add `HumanTaskConfig` interface (export it from `packages/core/src/index.ts`).
- `run.types.ts`:
  - add `"waiting"` to `NodeExecutionStatus`
  - add `"node.waiting"` and `"node.resolved"` to `RunEventType`

### 7.2 Migration (`packages/migrations/src/sql/016_human_tasks.sql`)

- Update the `node_execution_status` check (or accept new enum value if column is text).
- Create `jm_human_task_resolutions`:
  ```sql
  id                  uuid primary key
  run_id              uuid not null references jm_runs(id) on delete cascade
  node_id             text not null
  outcome             text not null
  comment             text null
  actor               text null
  source              text not null check (source in ('webhook','manual','timeout'))
  webhook_event_id    uuid null references jm_webhook_events(id)
  resolved_at         timestamptz not null default now()
  ```
  Index on `(run_id, node_id)`.

### 7.3 Converter (`packages/orchestrator/src/flow-json/conductor-converter.ts:176`)

Remove `human-task` from the `UnsupportedNodeTypeError` switch and add a real `case` that emits the engine task representation. Wires outgoing-edge `branchLabel` → outcome routing.

### 7.4 API routes (`packages/api-server/src/routes/`)

- New `human-tasks.ts`: `POST /runs/:runId/human-tasks/:nodeId/resolve` — body `{ outcome, comment? }`. Calls `resolveHumanTask` with `source: "manual"`, `actor` from session.
- Modify `webhooks.ts`: insert the "resolve-pending-task" branch before the new-run path described in §5.

### 7.5 Engine (`packages/orchestrator/src/`)

- New `resolveHumanTask` function — single internal entry point.
- Timeout timer scheduling for `config.timeout` (next to existing retry timers).
- Runner switches on `node.type === "human-task"` before phase dispatch — no phase-registry change.

---

## 8. Out of Scope (v1)

- **HMAC verification** — webhooks accepted unsigned, audit-logged. Separate spec later, with per-scope (user / org / global) secret resolution.
- **Per-node assignees / ACLs** — anyone with run access can resolve. No assignee picker.
- **Notifications (Slack / email) on task pending** — additive, separate spec.
- **Per-provider correlator/extractor refactor** — keep inline extraction in `webhooks.ts`; formalize the interface only when it grows unwieldy.
- **Non-issueRef correlation** — v1 correlates only via `issueRef`. Runs without an `issueRef` use the manual form only.
- **Parallel human-tasks in the same run** — engine is sequential today; if parallel branches are added later, multi-task pending state is handled then.
- **Outcome edges with conditions** — outcome label is the only branching key. No JSONLogic on human-task edges.

---

## 9. Risks & Open Questions

- **Webhook payload variance.** Jira / GitHub / GitLab / Monday all differ; `valuePath` + `commentPath` per provider should cover common cases, but exotic setups (custom Jira fields, GitHub draft reviews) may need additional config knobs in follow-up specs.
- **Cycle-visit accounting on rework loops.** Existing `maxCycleVisits` counts node visits — confirm the runner increments correctly when an outcome edge loops back to an already-visited node. Spot-check during implementation.
- **`paused` is overloaded.** Today `paused` is a manual user action; with this spec it also means "waiting on human". UI distinguishes by checking the latest `NodeExecution.status === "waiting"`.
