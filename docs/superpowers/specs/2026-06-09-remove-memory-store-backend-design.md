# Remove the in-memory store backend (Postgres-only)

**Date:** 2026-06-09
**Status:** Approved

## Goal

Eliminate the `memory` store backend entirely so PostgreSQL is the only
persistence path. Remove the `STORE_BACKEND` env var, the runtime toggle, the
`Memory*` store classes, and their tests.

Keep the always-in-memory *services* that are not store backends:
- `InMemoryStepRegistry` (step catalog registry)
- `InMemoryHumanTaskTimeoutService` (timeout scheduler)

These are unconditional in-process services regardless of persistence backend
and are out of scope.

## Background

`STORE_BACKEND` selected between two full sets of data stores in
`api-server/src/composition.ts` via `const useMemory = cfg.storeBackend === "memory"`:

- `postgres` (default): `Postgres*` stores backed by a `pg` pool.
- `memory`: `Memory*` stores — pure in-process objects, no DB connection.

The `Memory*` classes also doubled as fast, DB-free test fixtures. The Postgres
stores have **no** behavioral unit tests, so removing the memory tests removes
the only coverage of that orchestration logic (`markSkipped`,
`findAllWaitingWithCorrelation`, webhook-event matching). This coverage loss is
an accepted trade-off.

## Changes

### 1. Delete the memory store directory
Remove `packages/orchestrator/src/stores/memory/` in full:
- Store files: `memory-event-bus.ts`, `memory-flow-grants-store.ts`,
  `memory-flow-store.ts`, `memory-webhook-event-store.ts`,
  `memory-webhook-store.ts`, `memory-workflow-instance-grants-store.ts`,
  `memory-workflow-instance-store.ts`, `memory-workflow-trigger-store.ts`
- Test files: `mark-skipped.test.ts`, `matcher-decouple.test.ts`,
  `memory-workflow-instance-store.test.ts`, `memory-webhook-event-store.test.ts`

### 2. `orchestrator/src/stores/human-task-resolution-store.ts`
Remove the `MemoryHumanTaskResolutionStore` class. Keep
`PostgresHumanTaskResolutionStore`, the `IHumanTaskResolutionStore` interface,
and the `HumanTaskResolutionRow` type.

### 3. `orchestrator/src/index.ts`
Remove all `Memory*` store exports (including `MemoryHumanTaskResolutionStore`).
Keep the `InMemoryStepRegistry` export.

### 4. `api-server/src/composition.ts`
- Remove every `Memory*` import from `@journeyman/orchestrator`.
- Delete the `storeBackend` field from `CompositionConfig`.
- Remove the `const useMemory = ...` branch; always construct the `Postgres*`
  stores and a non-null `pool = createPool({ connectionString: cfg.databaseUrl })`.
- Simplify downstream `if (pool)` / `pool ?` guards (sandbox reaper) that exist
  only because `pool` could previously be null. `pool` is now always set.

### 5. `api-server/src/cli-start.ts`
Remove the `storeBackend: (process.env.STORE_BACKEND ...)` line from the `cfg`
object.

### 6. `orchestrator/src/cli-worker.ts`
- Remove the `import { MemoryEventBus }` line.
- Replace the no-pool branch at the events assignment
  (`const events = pool ? new PostgresEventBus(pool) : new MemoryEventBus()`)
  with a small inline no-op `IEventBus` for the DB-less path. The existing
  warning ("step events will be in-memory only and invisible to the workflow
  instance viewer") is updated to reflect that events are dropped, not buffered.
- The worker's env-only (no `DATABASE_URL`) mode is **preserved** — this change
  does not require a DB in the worker.

### 7. Delete `webhook-wait-sweeper.integration.test.ts`
`packages/api-server/src/services/webhook-wait-sweeper.integration.test.ts`
builds its composition with `storeBackend: "memory"` and `databaseUrl: ""`. It
cannot run once the memory backend is gone and is not being rewritten against
Postgres. Delete it. (This is a 5th lost test file beyond the 4 in §1.)

### 8. Config and docs cleanup
Remove the `STORE_BACKEND` line/row from:
- `.env.example`
- `.env.production.example`
- `compose.deploy.yml` (two occurrences)
- `deploy/k8s/base/configmap.yaml`
- `README.md`
- `docs/constitution/DEPLOYMENT.md`

Leave `docs/superpowers/plans/*` untouched (historical record).

## Coverage impact (accepted)

Five test files removed; the Postgres stores have no replacement unit tests.
This is the explicit trade-off of removing the memory backend entirely.

## Verification

- `npm run typecheck` — clean.
- `npm run check:boundaries` — clean.
- `npm test` — only the known pre-existing failures remain; no new failures.
  The deleted memory/sweeper tests no longer appear in the run.
- Repo-wide grep confirms no remaining references to `STORE_BACKEND`,
  `storeBackend`, or `Memory*Store` outside `docs/superpowers/plans/`.

## Out of scope

- Removing the worker's DB-less ("env-only") execution mode.
- Adding new Postgres-backed tests to replace the deleted coverage.
- `InMemoryStepRegistry` and `InMemoryHumanTaskTimeoutService` (not store backends).
