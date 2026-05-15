# Worker Logging & Observability — Design

**Date:** 2026-05-14
**Status:** Approved (brainstorming → ready for implementation plan)
**Scope:** `@journeyman/orchestrator` worker harness, conductor engine, phase handlers; `@journeyman/core` logger; `@journeyman/run-viewer` UI.

## Problem

Runs sometimes fail, sometimes silently stop, sometimes appear to skip phases. Today the operator cannot tell from either the run viewer or the worker's stdout *what happened, where, and why*. The three failure modes hurt roughly equally:

1. **Phase skipped** — run viewer shows phase A completed, then phase C started; B never ran. No visibility into why the flow took that edge.
2. **Run stops silently** — last event is `phase.started` or `phase.completed`; nothing afterwards. No `phase.failed`, no completion. Worker could have died, task could have been lost, Conductor could have stalled — we cannot tell.
3. **Run fails opaquely** — `phase.failed` exists but the payload is thin (`UnhandledError`, no stack, no cause, no sub-process context).

## Goal

Make every run self-explanatory in the run viewer for end users, and forensically debuggable in pino stdout / future log aggregators for operators. The same `workflowInstanceId` must let an operator pivot from one stream to the other.

## Non-Goals (deferred)

- OpenTelemetry traces / span IDs.
- Prometheus / metrics counters.
- Log shipping/transport config for AWS CloudWatch, Datadog, Loki (deployment concern).
- Per-org/user log filtering in the run viewer UI.

## Approach

Two cooperating streams — events for the user, pino for the operator — tied by a fixed correlation contract. Add new event types that fill the run-viewer blind spots (`phase.skipped`, `edge.taken`, `condition.evaluated`, `worker.heartbeat`, `task.polled`, `task.dispatched`). Enrich the existing `phase.failed` payload with stack, cause chain, last log lines, and sub-process context. Standardize lifecycle log moments across the worker harness, conductor engine, conductor client, and all phase handlers.

## Architecture

| Stream | Audience | Transport | Purpose |
|---|---|---|---|
| **Events stream** (`events.append`) | End users in run viewer | Postgres `events` table | The run's story: what happened to this phase, in this run, in order. |
| **Pino logs** | Operators (local stdout now; CloudWatch/Datadog later) | stdout (JSON in prod, pino-pretty in dev) | Forensic detail: poll cycles, dispatch, sub-process output, internal errors. |

### Correlation contract

Every pino log line and every event payload carries this set of fields:

- `workflowInstanceId` — our DB UUID (not Conductor's execution UUID).
- `nodeId` — `task.referenceTaskName`.
- `phaseType` — `task.taskDefName`.
- `attempt` — `task.retryCount + 1`.
- `taskId` — Conductor's task UUID, for cross-referencing Conductor's own logs.
- `workerId` — set on the harness.
- `durationMs` — present on terminal/end moments.

A grep on `workflowInstanceId=<uuid>` in any log aggregator returns the full forensic trail; the same UUID keys the run viewer URL.

### Helpers (in `@journeyman/core/logger.ts`)

- `createWorkflowLogger(base, ctx)` — returns a pino child pre-bound with the correlation fields. Handlers cannot accidentally forget the fields.
- `loggerForRun(base, ctx, workflowInstanceId)` — same as above, but consults `DEBUG_WORKFLOW_IDS` env (comma-separated list of UUIDs) and bumps that child to `debug` level if listed. Other runs stay at the global `LOG_LEVEL`.
- `serializeError(err)` — walks `err.cause` up to 3 levels, returns `{ errorClass, message, stack, cause?, code? }`. Applies redaction (`/token|secret|key|password|authorization/i`) to message and stack.
- `appendPhaseEvent(events, ctx, eventType, payload)` — wrapper around `events.append` that injects correlation fields and never throws (logs and swallows).

## Lifecycle moments

### Worker harness — `packages/orchestrator/src/workers/worker-harness.ts`

| Moment | Level | Event? | Notes |
|---|---|---|---|
| `poll.tick` | debug | — | Each long-poll iteration, gated behind debug. |
| `task.polled` | info | ✅ `task.polled` (debug-filtered in UI) | Task returned from Conductor. |
| `handler.missing` | error | ✅ `phase.failed` (existing) | No handler registered. |
| `cycle.exceeded` | warn | ✅ `node.cycled` (existing) | — |
| `secrets.resolve.start/end` | info | — | Standardize fields on existing logs. |
| `secrets.resolve.failed` | error | ✅ `phase.failed` (existing) | Include `missing` list. |
| `mcp.resolve.start/end/failed` | info/error | ✅ on fail (existing) | — |
| `skills.resolve.start/end/failed` | info/error | ✅ on fail (existing) | — |
| `phase.dispatch` | info | ✅ `phase.started` (existing) | Right before `handler.run`. |
| `phase.heartbeat` | debug | ✅ `worker.heartbeat` | Every `WORKER_HEARTBEAT_MS` (default 30000) while `handler.run` is pending. Carries `elapsedMs`. |
| `phase.completed` | info | ✅ `phase.completed` (existing) | Add `durationMs`. |
| `phase.failed` | error | ✅ `phase.failed` (existing) | Enriched payload, see Error Enrichment. |
| `workspace.create/destroy` | info/warn | — | Standardize fields. |

### Conductor orchestrator — `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`

| Moment | Level | Event? | Notes |
|---|---|---|---|
| `workflow.start` | info | (existing) | — |
| `decision.evaluate` | info | ✅ `condition.evaluated` | Per condition: which expression, which inputs, result. |
| `decision.route` | info | ✅ `edge.taken` | Which target node was chosen. |
| `node.skipped` | info | ✅ `phase.skipped` | When the flow bypasses a node, with reason. |
| `workflow.complete/failed` | info/error | (existing) | — |

### Conductor client — `packages/orchestrator/src/engines/conductor/conductor-client.ts`

`pollTask` and `completeTask` emit `request.start` / `request.end` / `request.failed` at debug level. This is where "silent stop" forensics live — if Conductor stops handing out tasks, polls succeed but return nothing, and that is visible.

### Phase handlers — `packages/orchestrator/src/workers/phases/*.ts`

Every handler emits a consistent three-moment minimum:

| Moment | Level | Notes |
|---|---|---|
| `handler.start` | info | Inputs (redacted), workspaceDir. |
| `handler.step.*` | debug | Each meaningful sub-step (clone, scan, API call, sub-process spawn). Handler-specific. |
| `handler.end` | info | `result.kind`, `durationMs`, output summary. |

Sub-process spawns (git, gh, claude CLI, etc.) emit `subprocess.exec` (debug, command redacted) and `subprocess.exit` (info on success, error on non-zero, with stderr tail). The 17 handlers in `packages/orchestrator/src/workers/phases/` are swept consistently; handlers that spawn processes get the wrapper (clone-repos, custom-ai, etc.).

## Error enrichment

Today the `phase.failed` payload is thin and the unhandled-error branch at `worker-harness.ts:332` drops the stack. New payload shape (additive):

```json
{
  "error": {
    "errorClass": "...",
    "message": "...",
    "stack": "...",
    "cause": { "errorClass": "...", "message": "...", "stack": "..." },
    "code": "...",
    "retryable": false
  },
  "reason": "missing_secrets | mcp_resolution_failed | skills_resolution_failed | configuration_error | handler_error | unhandled",
  "tail": ["<last 20 phase.log lines>"],
  "subprocess": {
    "command": "git clone ...",
    "exitCode": 128,
    "stderrTail": "<last 2KB>"
  }
}
```

Capture rules:

1. **Stack + cause chain.** `serializeError(err)` replaces every existing `String(err?.message ?? err)`.
2. **Log tail.** Per-phase ring buffer (capacity 20) of `log()` calls from the handler; attached on failure. Bounded memory.
3. **Sub-process context.** Sub-process wrapper records `{ command (redacted), exitCode, stderrTail (last 2KB) }`. Latest record attached on failure.
4. **Conductor compatibility.** `reasonForIncompletion` passed to `completeTask` stays a plain string (unchanged); the *event* payload always uses the structured shape above.
5. **Pino mirror.** Every `phase.failed` event also produces a `log.error({ ...ctx, error })` so the same info is in stdout.
6. **Redaction.** All error messages and stacks pass through the redactor before serialization.

## Heartbeats

While `handler.run()` is awaiting, the harness emits liveness signals on a 30-second interval:

```ts
const startedAt = Date.now();
const heartbeat = setInterval(() => {
  const elapsedMs = Date.now() - startedAt;
  appendPhaseEvent(events, ctx, "worker.heartbeat", { elapsedMs, workerId });
  log.debug({ ...ctx, elapsedMs }, "phase.heartbeat");
}, Number(process.env.WORKER_HEARTBEAT_MS ?? 30_000));
try {
  const result = await handler.run(...);
} finally {
  clearInterval(heartbeat);
}
```

- Interval configurable via `WORKER_HEARTBEAT_MS`; set to `0` to disable.
- Run viewer collapses consecutive heartbeats into a single live "running for 2m 14s" ticker on the active phase.
- Cost: ~120 rows/hour per active phase. Acceptable.

## Per-run debug override

Two knobs:

1. **Global:** `LOG_LEVEL=debug` raises everything (already works via pino).
2. **Targeted:** `DEBUG_WORKFLOW_IDS=<uuid>,<uuid>` — when set, `loggerForRun` returns a debug-level child for matching `workflowInstanceId`s; other runs stay at the global level. Lets an operator spotlight one bad run in prod without flooding the rest.

Debug is operator-side only; the events stream is unchanged by these knobs.

## Run viewer UI

### New event renderers — `packages/run-viewer/src/`

| Event type | Rendering |
|---|---|
| `phase.skipped` | Greyed-out node row with `"skipped — <reason>"` subtitle. |
| `edge.taken` | Inline arrow annotation on the timeline: `"→ went to <targetNode> because <conditionLabel>"`. |
| `condition.evaluated` | Collapsed under the node it belongs to; expand shows expression, inputs, result. |
| `worker.heartbeat` | Not a row — collapsed into a live "running for 2m 14s" badge on the currently-active phase. |
| `task.polled` | Hidden by default (debug filter). |
| `task.dispatched` | Hidden by default (debug filter). |

### Filter toolbar

A single "Show debug events" toggle in the run viewer header, off by default. When off, `task.polled`, `task.dispatched`, and individual `worker.heartbeat` rows are hidden (the live ticker still shows on the active phase).

### Error display

`phase.failed` rows get an expandable "Details" section showing the enriched payload: error class + message at the top, then collapsible sections for stack, cause chain, log tail (last 20 lines), and sub-process info if present. Purely additive on the existing row — no new pages or routes.

## Configuration surface

| Env | Default | Purpose |
|---|---|---|
| `LOG_LEVEL` | `info` | Global pino level. |
| `DEBUG_WORKFLOW_IDS` | `""` | Comma-separated `workflowInstanceId`s to log at debug. |
| `WORKER_HEARTBEAT_MS` | `30000` | Heartbeat interval; `0` disables. |
| `NODE_ENV` | — | Selects pino-pretty in dev (existing behavior). |

## Rollout order

Each commit independently shippable:

1. **Contract helpers in core** — `createWorkflowLogger`, `loggerForRun`, `serializeError`, `appendPhaseEvent`, redaction. Unit-tested.
2. **Harness instrumentation** — standardize fields, heartbeats, ring-buffer log tail, error enrichment, per-run debug. Unit tests around `processOnce` covering: success, retryable failure, terminal failure, missing handler, cycle limit, unhandled throw, sub-process exit.
3. **Conductor orchestrator** — emit `condition.evaluated`, `edge.taken`, `phase.skipped`.
4. **Conductor client** — debug logs for `pollTask` / `completeTask`.
5. **Phase handlers** — sweep all 17, add `handler.start` / `handler.step.*` / `handler.end`, sub-process wrapper for handlers that spawn processes.
6. **Run viewer** — new renderers + debug filter toggle.

## Testing

- **Unit tests** alongside each layer; harness tests are the heaviest because that's where most logic moves.
- **Integration:** one end-to-end test through the existing in-memory orchestrator rig asserting the full event sequence, including new event types.
- **Manual smoke:** trigger a real run locally, watch pino stdout for standardized fields, open run viewer, kill the worker mid-phase and confirm heartbeats stop and the next operator can see "last heartbeat at X" to diagnose silent stop.

## Backward compatibility

- All event-stream additions are additive — old runs render fine with the new viewer (new renderers no-op on absence).
- `phase.failed` payload is additive — old consumers ignore new fields.
- `reasonForIncompletion` strings to Conductor unchanged.

## Open follow-ups (not in scope)

- OpenTelemetry trace/span IDs.
- Metrics counters (`phases_run_total`, `phase_duration_ms`, `phase_failures_total{reason}`).
- Log shipping config for CloudWatch / Datadog.
- Per-org/user log filtering in the run viewer.
