# Plan: Reconcile orphaned workflow instances on Conductor 404

## Problem

When Conductor no longer knows a workflow id (404 — typically because Conductor's
storage was reset while the orchestrator DB kept the run as `running`), the
`WorkflowInstanceSyncer` polls it forever: `getWorkflow` 404s → `request()` throws
→ the syncer catches, logs `syncStatus failed`, and leaves the instance
non-terminal, so it's polled again ~1.5s later, indefinitely.

Root cause: nothing treats a Conductor 404 as terminal, so the instance never
leaves the `NON_TERMINAL` list in `syncOnce`.

## Fix (durable) — three guards

A naive "404 → mark failed" is unsafe. The fix needs all three:

1. **Own non-retrying terminal path.** A 404 must NOT flow through the existing
   `mapped === "failed"` branch — that runs `shouldWorkflowRetry` →
   `retryWorkflow(engineWorkflowId)`, which would itself 404. The 404 case gets
   its own branch that marks the instance `cancelled` directly (honest label:
   "engine no longer has this run") and runs the sandbox reaper.

2. **Detect 404 specifically, not any error.** A transient outage / 503 / network
   blip must keep the run non-terminal and retry. Implement by having
   `ConductorClient.getWorkflow` return `null` on a 404 and re-throw everything
   else. `request()` gains a typed `ConductorHttpError { status }` so 404 can be
   distinguished without string-matching; its thrown message is unchanged so
   existing callers/logs are unaffected.

3. **Grace guard against the start race.** `engineWorkflowId` is persisted only
   after `startWorkflow` returns, but Conductor's read path can briefly lag its
   write path. Guard with a **consecutive-404 counter** (in-memory `Map`, same
   pattern as `workflowRetryPending`): only reconcile to terminal after
   `NOT_FOUND_TERMINAL_THRESHOLD` (2) consecutive 404s for that instance. A single
   404 returns the current status unchanged (stays non-terminal, retries next
   tick). Any successful `getWorkflow` resets the counter. Chosen over a
   `startedAt` time window because it needs no clock and is deterministic to test;
   it also never false-positives across process restarts (counter resets ⇒ at
   worst a delayed cleanup, never a wrongful kill).

## Files

- `packages/orchestrator/src/engines/conductor/conductor-client.ts`
  - Add `export class ConductorHttpError extends Error { status }`.
  - `request()` throws `ConductorHttpError(res.status, <same message>)` on non-2xx.
  - `getWorkflow()` catches `ConductorHttpError` with `status === 404` → returns
    `null`; return type becomes `… | null`.
- `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`
  - `syncStatus`: when `getWorkflow` returns `null`, run the counter guard →
    either return unchanged status (below threshold) or mark `cancelled` (at
    threshold). Reset counter on a non-null result.
  - Add `private notFoundCounts = new Map<string, number>()` and
    `NOT_FOUND_TERMINAL_THRESHOLD = 2`.

## Tests (TDD — written first)

Client (`conductor-client.notfound.test.ts`):
- `getWorkflow` returns `null` on a 404 response.
- `getWorkflow` throws on a 503 response (non-404 propagates).

Orchestrator (`conductor-orchestrator.syncStatus.test.ts`, added cases):
- single 404 (count 1) → returns `running`, `setStatus` not called terminal (guard 3).
- two consecutive 404s → 2nd marks `cancelled` and returns `cancelled` (the fix).
- 404 then success resets the counter → a later single 404 doesn't terminate (guard 3).
- a non-404 `getWorkflow` rejection propagates and does not mark terminal (guard 2).
