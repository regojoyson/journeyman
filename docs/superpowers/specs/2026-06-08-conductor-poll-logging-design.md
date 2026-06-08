# Conductor poll-loop log hygiene + configurable interval

**Date:** 2026-06-08
**Status:** Approved (design)
**Scope:** `packages/orchestrator`

## Problem

At `LOG_LEVEL=debug`, the worker floods the console with per-poll log lines that
report nothing happened.

Mechanism:

- The worker runs **one poll loop per registered step type** (~10: `clone-repos`,
  `custom-ai`, `get-repository`, `open-pull-request`, `comment-on-issue`,
  `list-workspace-files`, `start-feature-branch`, `join-finalize`, …). Each loop
  polls Conductor independently — see [`WorkerHarness.start`](../../../packages/orchestrator/src/workers/worker-harness.ts).
- The interval is hardcoded to **500ms** in
  [`cli-worker.ts`](../../../packages/orchestrator/src/cli-worker.ts) (`pollIntervalMs: 500`),
  with the same default in
  [`worker-harness.ts`](../../../packages/orchestrator/src/workers/worker-harness.ts).
- Each poll emits **two** debug lines in
  [`ConductorClient.pollTask`](../../../packages/orchestrator/src/engines/conductor/conductor-client.ts):
  `conductor.poll.request.start` and `conductor.poll.request.end`.

Result when idle: ~10 step types × 2 lines × 2 polls/sec ≈ **40 lines/second**, almost
all `hasTask:false`. Sample (note `"level":20` = pino debug):

```json
{"level":20,"ns":"conductor:client","stepType":"clone-repos","hasTask":false,"durationMs":106,"msg":"conductor.poll.request.end"}
{"level":20,"ns":"conductor:client","stepType":"custom-ai","msg":"conductor.poll.request.start"}
```

These lines only appear at `debug`. At `info` the worker is silent on empty polls
(verified: [`processOnce`](../../../packages/orchestrator/src/workers/worker-harness.ts)
returns before logging when `task` is null). The goal is to keep `debug` usable for
real diagnostics instead of drowning it in idle-poll chatter.

**Not the cause (explicitly ruled out):** the Conductor server container
(`conductor.properties` logging) — the flooding lines come from the Node worker
(`ns:"conductor:client"`), not the JVM.

## Changes

### 1. Poll-log hygiene — `conductor-client.ts` `pollTask`

| Line | Now | After |
|---|---|---|
| `conductor.poll.request.start` | `debug`, every poll | **removed** (no information the `.end` line lacks) |
| `conductor.poll.request.end`, empty (`hasTask:false`) | `debug` | demote to **`trace`** (level 10) |
| `conductor.poll.request.end`, productive (`hasTask:true`) | `debug` | **keep at `debug`** — a real pickup event |
| `conductor.poll.request.failed` | `error` | unchanged |

Effect at `debug`: only polls that picked up work, plus failures. Full per-poll
visibility is still available by setting `LOG_LEVEL=trace`.

### 2. Configurable poll interval — `cli-worker.ts`

Replace the hardcoded value:

```ts
// before
pollIntervalMs: 500,

// after
pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000),
```

- New env var **`WORKER_POLL_INTERVAL_MS`**.
- **Default raised 500 → 2000ms.** Halves+ the request and log rate out of the box.
- The existing `?? 500` fallback inside
  [`worker-harness.ts`](../../../packages/orchestrator/src/workers/worker-harness.ts)
  `loop()` stays as a defensive default; the live value always comes from `cli-worker.ts`.

#### Interval trade-off (documented for operators)

The interval is a dial between pickup latency and chatter/load. Lower = faster step
transitions, more requests. Higher = quieter and lighter, slower transitions. Because
the pipeline runs steps sequentially, the per-poll wait is paid at every hop.

| Interval | Load (~10 step types) | Avg wait before next step starts |
|---|---|---|
| 500ms (old) | ~20 req/s | ~0.25s |
| 1000ms | ~10 req/s | ~0.5s |
| **2000ms (new default)** | ~5 req/s | ~1s |
| 5000ms | ~2 req/s | ~2.5s (worst case 5s) |

2000ms is invisible next to a `custom-ai` step that runs for minutes, while removing
most of the idle traffic. Operators wanting snappier pickup or even less chatter set
`WORKER_POLL_INTERVAL_MS` per environment.

## Out of scope (YAGNI)

- **Conductor server logging** (`conductor.properties`) — not the source.
- **Build-loop interval** (3s) — already silent when idle.
- **Long-polling** — Conductor supports a blocking poll (`?timeout=`) that would
  collapse the N busy-wait loops into blocking calls and cut request volume far more
  than tuning the interval. This is the recommended **next step**, but it is a
  behavior change with more risk and is intentionally excluded from this pass.

## Testing

Unit tests in `packages/orchestrator`:

1. `pollTask` — empty poll (`hasTask:false`): asserts **no** `debug` line is emitted
   (spy/mock logger), and the `trace` line is emitted.
2. `pollTask` — productive poll (`hasTask:true`): asserts exactly one `debug`
   `conductor.poll.request.end` line.
3. `pollTask` — failure path: asserts the `error` line still fires.
4. Interval config — `WORKER_POLL_INTERVAL_MS` is parsed and falls back to `2000`
   when unset/invalid.

## Risk & reversibility

Pure logging-level changes plus one env-driven constant. No change to task polling,
dispatch, or completion logic. Fully reversible by restoring the two call sites.
