# Journeyman Builder — Future TODO

Deferred items surfaced while designing the Builder (see
[2026-06-13-journeyman-builder-design.md](2026-06-13-journeyman-builder-design.md)).
These are **platform capabilities the Builder is limited by today** — not v1
Builder behavior. Until they land, the Builder must handle them honestly (flag a
gap, explain the workaround). Revisit when prioritizing future work.

## 1. Scheduled / recurring triggers (no native cron)

**Gap:** There is no schedule/cron trigger. Trigger node types are only
`trigger-manual`, `trigger-webhook`, `trigger-human`. `TriggerSource` lists
`"schedule"` and `"api"` as values, and `validate-for-publish` even mentions
"schedule," but no node type or scheduler component implements it.

**Today's workaround:** an external scheduler (system cron, GitHub Action, CI job)
calls `POST /workflows/:id/workflow-instances` on a schedule (`triggerSource:
"api"`); the flow uses a manual/api start.

**Builder behavior until fixed:** when the user asks for "every morning / on a
schedule," build a manual/api-started flow and tell the user they need an external
scheduler — do not pretend a native schedule exists.

**Future work:** add a `trigger-schedule` node type + a scheduler component
(cron expression → enqueue a run). Once it exists, the Builder picks it up via
`listSupportedNodeTypes` automatically (per the spec's Extensibility section).

## 2. For-each / fan-out over a collection

**Gap:** The `loop` node is a condition/count loop (`DO_WHILE`), **not** a
for-each over an array. There is no map/fan-out construct and no loop-item
reference in the `@token` / `${}` / JSONLogic system (only a
`$.{nodeId}.iteration` counter; refs resolve `workflow.input.*`,
`workflow.attribute.*`, `output.*`, pause-node outputs — no "current item" scope).

**Today's workaround:** collapse "do X for each item" into a **single custom-AI
batch step** that receives the whole collection and iterates internally (its own
code/bash), e.g. comment on each PR within one step.

**Builder behavior until fixed:** when the user asks for per-item work over a
collection, build one batch-processing AI step — never a (nonexistent) for-each
loop.

**Future work:** add a real for-each / map node (iterate a list as separate
iterations) with a scoped loop-item reference in the reference resolver. Then the
Builder can fan out at the workflow level instead of hiding iteration in a step.

## 3. Richer step/list filters (e.g., PR age)

**Gap:** `list-pull-requests` filters by `state`/`head` only — no `createdAt` /
`updatedAt` / age filter. Other list steps are similarly minimal.

**Today's workaround:** filter downstream — inside the batch AI step (or a
condition) that consumes the list.

**Builder behavior until fixed:** don't assume a list step can pre-filter; filter
in the consuming step.

**Future work:** add filter parameters to list steps where useful (age, author,
label) so flows can narrow at the source.

## 4. In-flow failure handling (error edges / onFailure / try-catch)

**Gap:** The `"error"` edge type and `RetryPolicy.onFailure` are declared in the
types but the converter never honors them — a failure just terminates the whole
run, with no in-flow "on failure, do X" routing. `try-catch` and `retry-block`
node types throw `UnsupportedNodeTypeError`. Only **per-node retry** is honored.

**Today's workaround (and Builder behavior until fixed):** offer per-step retry,
an out-of-band run-failure alert (run-status callback), or a self-handling AI step
that catches its own error — never an in-flow error-handler branch (it would
silently never fire). See the "Failure handling" rule in the spec.

**Future work:** make the converter honor `"error"` edges + `onFailure` (route a
failed step to a handler node), and/or implement `try-catch` / `retry-block`. Once
honored, the Builder picks them up via the authoritative converter check and can
build real in-flow failure branches.

## External dependencies the Builder is waiting on

These are not Builder work, but the Builder's "build only on what's real" deny-list
(see spec) tracks them until they're done:

- **Jira `transitionIssue` + `commentOnIssue`** — currently `throw "...not
  implemented"` despite the provider's catalog flag being `true`. Blocks Jira
  handover/report-back; the Builder routes around them (e.g. comment on the PR).
  Fix = implement the two Jira MCP operations (and correct the misleading catalog
  flag).
- **Stale node-support comment** in `flow.types.ts` (claims loop/gateway/timer are
  unsupported; the converter implements them). Tracked as a separate cleanup chip.
