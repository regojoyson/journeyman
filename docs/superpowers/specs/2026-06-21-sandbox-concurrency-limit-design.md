# Per-Sandbox Concurrency Limit — Design

**Date:** 2026-06-21
**Status:** Approved (design)

## Summary

Each sandbox gets an optional **maximum concurrent instances** number. When that
many runs are already using a sandbox and another run needs it, the new run does
not fail — it backs off and Conductor retries it until a slot frees up. Leaving
the number blank (or `0`) means no limit, exactly like today.

The limit applies to **every** sandbox type (docker, local, kubernetes, ecs,
ec2, machines, cloud). For per-instance types (docker, etc.) the number caps how
many units run at once; for shared types (local) it caps how many runs may use
that one workspace concurrently.

## Approach

Enforce a single DB-backed gate in `ensureWorkspace`, atomic via a **single
SQL statement** that takes a per-sandbox advisory lock, counts, and conditionally
inserts the claim. When a sandbox is at capacity, throw `SandboxAtCapacityError`.

Wait-and-retry is handled by the **existing in-process retry loop** in
`worker-harness.ts` (the same loop that already waits on `ImageNotReadyError`):
it catches the error, sleeps, and re-calls `ensureWorkspace` in place, honoring
the step's abort/deadline. We extend that loop to also retry on
`SandboxAtCapacityError`. The in-process loop is the primary queue (works even
when no Conductor retry policy is configured); the outer-catch `FAILED` branch is
a fallback for when in-process attempts are exhausted.

> **Dry-run correction.** An earlier draft assumed the wait happened via
> Conductor re-queue of a `FAILED` task. It does not — the real wait is the
> in-process `while` loop in `worker-harness.ts` (~L405). The gate must hook
> that loop, not rely on Conductor retries.

Rejected alternatives:

- **Per-backend counting** (each backend's `checkRunnable` counts its own live
  units): most accurate but every backend reimplements it, and local/shared
  can't meaningfully count — fails the "all sandbox types" requirement.
- **Gate at run-submission** (reuse `AgentSafetyLimits` / `AgentSkipReason`):
  counts agent runs, not actual sandbox instances, so the two drift; doesn't
  express per-sandbox host capacity.

## Data Model

### Types (`packages/core/src/types/sandbox.types.ts`)

Add to `Sandbox`, `CreateSandboxArgs`, `UpdateSandboxArgs`:

```ts
/** Max concurrent provisioning+active instances for this sandbox. null/0 = unlimited. */
maxConcurrentInstances?: number | null;
```

`rowToSandbox` maps `max_concurrent_instances` → `maxConcurrentInstances`.

### Migration `065_sandbox_concurrency_limit.sql`

```sql
ALTER TABLE jm_sandboxes
  ADD COLUMN max_concurrent_instances integer;

-- uuid to match jm_sandboxes.id; nullable (no FK — instances may outlive a sandbox).
ALTER TABLE jm_sandbox_instances
  ADD COLUMN sandbox_id uuid;

-- Speeds up the per-sandbox capacity count.
CREATE INDEX IF NOT EXISTS idx_jm_sandbox_instances_sandbox_status
  ON jm_sandbox_instances (sandbox_id, status);
```

`sandbox_id` is nullable: pre-existing instance rows stay `null` (they drain out
naturally), and every new claim records it. This column is what lets us count
instances **per sandbox record** rather than per `type`.

### Validation (`packages/sandbox/src/sandbox-record.ts`)

Extract `validateMaxConcurrentInstances(v)`: when present, `v` must be `null` or
an integer `0 <= v <= 10000` (reject negatives, non-integers, NaN, and
fat-finger huge values); otherwise throw `InvalidSandboxInputError`. `0`/`null` =
unlimited.

- Called inside `validateSandboxInput` (the POST path).
- **Also called directly in the PATCH route** — the PATCH handler currently runs
  *no* validation (`validateSandboxInput` is POST-only), so the field validator
  must be invoked there explicitly.

## Counting + Atomic Gate

New store function in `sandbox-instance-store.ts`:

```ts
export class SandboxAtCapacityError extends Error {} // err.name = "SandboxAtCapacityError"

export async function claimSandboxInstanceWithCapacity(
  db: Queryable,
  row: { runId: string; type: string; owner: string; sandboxId: string; limit: number | null },
): Promise<boolean>  // true ⇒ won the claim; false ⇒ lost the race (caller waitActive); throws SandboxAtCapacityError when full
```

**Why not a multi-step transaction.** `Queryable` is just `{ query() }`; on a
`pg.Pool` consecutive `query()` calls may use different physical connections, so
`pg_advisory_xact_lock` taken in one call would not be held during a later
`INSERT`. The whole gate must therefore be **one statement** (its own implicit
transaction), following the codebase's existing atomic-claim idiom
(`claimPendingBuild`).

**Fast path (unlimited).** When `limit == null || limit <= 0`, skip the lock
entirely and delegate to the plain `claimSandboxInstance` (which now also writes
`sandbox_id`). This keeps the common case lock-free.

**Limited path — single statement:**

```sql
WITH lk AS (
  SELECT pg_advisory_xact_lock(hashtext('jm_sbx_cap:' || $4::text)) AS locked
),
cap AS (
  -- cross-joins lk so the count cannot be computed before the lock is held
  SELECT count(*) AS n
  FROM jm_sandbox_instances i, lk
  WHERE i.sandbox_id = $4 AND i.status IN ('provisioning','active')
),
ins AS (
  INSERT INTO jm_sandbox_instances (run_id, type, handle, status, owner, sandbox_id)
  SELECT $1, $2, '', 'provisioning', $3, $4
  FROM cap
  WHERE cap.n < $5
  ON CONFLICT (run_id) DO NOTHING
  RETURNING run_id
)
SELECT (SELECT count(*) FROM ins) AS inserted,
       EXISTS (SELECT 1 FROM jm_sandbox_instances WHERE run_id = $1) AS run_exists;
```

Params: `$1 runId, $2 type, $3 owner, $4 sandboxId, $5 limit`. The count is
**global per sandbox** (the `owner` column is ignored) — it models host capacity.
In-flight `provisioning` rows count, so we never overshoot. The advisory
xact-lock serializes concurrent claims for the same sandbox and is released when
the statement's implicit transaction ends.

**Disambiguating the result** (both "at capacity" and "lost the claim race"
insert 0 rows — they need opposite handling):

| `inserted` | `run_exists` | Meaning | Return |
|---|---|---|---|
| 1 | true | won the claim | `true` |
| 0 | true | another worker already claimed this run | `false` (caller `waitActive`s) |
| 0 | false | blocked by capacity | **throw `SandboxAtCapacityError`** |

`claimSandboxInstance` (the unlimited fast path) also begins persisting
`sandbox_id`. `recordSandboxInstance` has no production callers and is left
untouched.

## Threading the Limit

- **`ResolvedSandbox`** (`packages/core/src/types/execution-environment.types.ts`)
  gains `maxConcurrentInstances?: number | null`.
- **`resolver.ts` `toResolved`** maps it from the `Sandbox` row.
- **cli-worker `resolveSandbox` dep** ([cli-worker.ts:184](../../packages/orchestrator/src/cli-worker.ts))
  passes `maxConcurrentInstances` through; the no-pool branch returns
  `undefined` (no limit).
- **`EnsureWorkspaceDeps.claim`** signature extends to
  `{ runId, type, owner, sandboxId, limit }`. cli-worker wires it to
  `claimSandboxInstanceWithCapacity(pool, row)`; the no-pool branch returns
  `true` (provision, no limit) exactly as today.

## Wait-and-Retry Wiring

### `ensureWorkspace` (`packages/orchestrator/src/sandbox/ensure-workspace.ts`)

- The `status === "active"` / `status === "provisioning"` early-returns stay
  **before** the gate, so a run already holding a slot is never re-gated on a
  later step (reconnect path).
- After `backend.checkRunnable`, call `deps.claim` with
  `{ runId, type, owner: orgId, sandboxId: worker.id, limit: worker.maxConcurrentInstances }`.
- `claim` returning `false` keeps the existing behavior (lost the race →
  `waitActive`). `SandboxAtCapacityError` propagates up unchanged.
- New `releaseClaim(runId)` dep (→ `markSandboxInstanceDestroyed`) called in the
  `env.provision()` catch so a provision failure frees its slot immediately
  (see Slot Lifecycle).

### `worker-harness.ts` — the in-process wait loop

The existing loop (~L405) already retries `ensureWorkspace` in-process on
`ImageNotReadyError`. Extend its catch to also retry on
`SandboxAtCapacityError`:

```ts
// separate counter from imageAttempt — distinct budgets
if (err?.name === "SandboxAtCapacityError" && capacityAttempt < capacityRetryAttempts) {
  capacityAttempt++;
  // log "⏳ sandbox at capacity; waiting for a free slot (attempt n/N)…"
  await delayOrAbort(capacityRetryDelayMs, abort.signal);  // honors step deadline/abort
  continue;
}
```

Capacity uses its **own counter and budget** (`SANDBOX_CAPACITY_RETRY_ATTEMPTS`,
`SANDBOX_CAPACITY_RETRY_DELAY_MS`), separate from `imageAttempt`, defaulting to a
generous window since a free slot depends on other runs finishing, not a bounded
image build. The loop already checks `abort.signal.aborted`, so a step
`timeoutSeconds` still bounds the wait.

**Bounded, not infinite.** The wait is capped by this budget *and* the step
timeout/abort. Past that the run fails (and re-queues only if the flow/step has a
retry policy). An unbounded queue is not achievable with the in-process loop —
this is the accepted behavior.

**Fallback.** If the in-process budget is exhausted, the error throws to the
outer catch, which adds a branch mirroring `ImageNotReadyError`: append a
`step.failed` event (`reason: "sandbox_at_capacity"`) and `completeTask({ status:
"FAILED" })`, so Conductor re-queues *if* a retry policy is configured.

## Slot Lifecycle — Freeing Capacity

A `provisioning` or `active` row consumes a slot until it flips to `destroyed`.
The dry run found that *failed* provisioning currently never frees its slot,
which would leak capacity under the new count. Required changes:

- **Normal completion (already correct).** On terminal run status `sandboxReaper`
  destroys the active instance, and `SandboxInstanceReaper` is a periodic backstop
  — both call `markSandboxInstanceDestroyed`. No change.
- **Stuck provisioning (fix).** `ProvisioningReaper.failRun`
  (`api-server/src/composition.ts`) marks only the workflow failed today. Add
  `await markSandboxInstanceDestroyed(pool, id)` so a crashed/stuck provision
  frees its slot. `findStuckProvisioningRuns` already finds these rows by
  `status='provisioning'` + age.
- **`provision()` failure (fix).** In `ensureWorkspace`, the catch around
  `env.provision()` runs *after* a won claim, so a failure leaves a
  `provisioning` row. Add a `releaseClaim(runId)` dep and call it in that catch
  to free the slot immediately (instead of waiting out `PROVISION_TIMEOUT_MS`
  ~10 min). **`releaseClaim` must DELETE the row, not mark it `destroyed`** — see
  "Leftover rows poison retry" below. New store fn
  `releaseSandboxClaim(db, runId)`:
  `DELETE FROM jm_sandbox_instances WHERE run_id=$1 AND status='provisioning' AND handle=''`
  (the `handle=''` guard guarantees it can only remove an un-provisioned claim,
  never a live instance).
- **Defense in depth (optional).** The count may ignore `provisioning` rows older
  than `PROVISION_TIMEOUT_MS` (`status='active' OR (status='provisioning' AND
  created_at > now() - …)`) so even a missed reap can't wedge a sandbox shut.

### Leftover rows poison retry (dry-run finding)

`ensureWorkspace` early-returns only for `status='active'` / `'provisioning'`;
the claim is `INSERT … ON CONFLICT (run_id) DO NOTHING → false → waitActive`.
Because `ON CONFLICT` fires on the `run_id` PK **regardless of status**, *any*
leftover row for that run (e.g. a `destroyed` one) makes a Conductor retry of the
same run fall through to `claim → false → waitActive`, which then polls for an
`active` that never comes and times out (~5 min) before failing. It would also
make capacity's `run_exists` read `true` and misclassify the block as a
lost-race.

`run_id` is a unique workflow-instance id (never reused), and the only mid-run
row that can be left behind by a *retryable* failure is the un-provisioned claim
from `provision()` failing. **Deleting** it on release (rather than marking it
`destroyed`) removes the poison so the retry re-claims cleanly.
`ProvisioningReaper.failRun` keeps `markSandboxInstanceDestroyed` — that run is
terminal and won't retry, and the destroyed row preserves audit history.

## Config Propagation

- **`db.ts`:** add `max_concurrent_instances` to the shared `COLS` constant (so
  every `SELECT … RETURNING` surfaces it and `rowToSandbox` maps it); add it to
  the `insertSandbox` column list + values; add an `updateSandbox` `set()` branch.
  Because `set()` skips `undefined`, sending **`null` explicitly clears** the
  limit (back to unlimited) — omitting it leaves it unchanged.
- **Routes (`routes/index.ts`):** POST and PATCH both pass
  `maxConcurrentInstances: body.maxConcurrentInstances`. PATCH additionally calls
  `validateMaxConcurrentInstances` (it runs no validation today).
- **Types:** `Sandbox`, `CreateSandboxArgs`, `UpdateSandboxArgs`,
  `ResolvedSandbox`, and the web `SandboxUpsertBody` gain the field.
- `resolveSandbox` → `toResolved` surfaces it to `ensureWorkspace`.
- **Exports (`packages/sandbox/src/index.ts`):** add
  `claimSandboxInstanceWithCapacity`, `releaseSandboxClaim`, and
  `SandboxAtCapacityError` (the index lists instance-store exports explicitly).
- **`EnsureWorkspaceDeps`:** `claim` signature →
  `{ runId, type, owner, sandboxId, limit }`; add a `releaseClaim(runId)` dep.
  The `ensure-workspace` test fakes and the cli-worker wiring update to match
  (no-pool branch: `claim` → `true`, `releaseClaim` → no-op).
- **`reason` string is free-form** — there is no `StepFailedReason` enum, so
  `"sandbox_at_capacity"` needs no type change.

## UI

A generic **"Max concurrent instances"** number input in the top, type-agnostic
section of `packages/web/src/components/sandboxes/SandboxFormModal.tsx` — not the
per-type config forms, since it applies to every type. Helper text: "Leave blank
for no limit." Mapping rules:

- Empty string ⇒ send **`null`** (not `0`, not omitted) so an existing limit can
  be cleared on edit.
- The create `body` *and* the edit `patch` objects must both include the field
  (the patch object lists fields explicitly).

> **Scope note (dry-run finding).** All sandbox CRUD routes are org-scoped
> (`/api/orgs/:orgId/sandboxes`, `updateSandbox … WHERE org_id = $`), so the UI
> can only set the limit on **org-scoped** sandboxes. System-scoped sandboxes
> (`org_id = null`) get their limit via seed/CLI. The *column* and the *gate*
> apply to every sandbox regardless of scope.

## Decisions / Edge Cases

- **Global, not per-org, count.** A limit of 5 on a system-scoped Docker sandbox
  means 5 total across all orgs — it models host capacity. (`owner` is ignored
  in the count.)
- **Reconnects don't re-gate.** The active/provisioning early-returns run before
  the gate, so a run already holding a slot never gets blocked on a later step.
- **Destroyed instances free slots immediately** — status flips to `destroyed`,
  excluded from the count. The existing reaper handles orphaned/leaked rows.
- **`limit = 0` / null / undefined ⇒ unlimited** — the lock-free fast path
  (plain `claimSandboxInstance`) is taken; no advisory lock.
- **Waiting runs do not consume capacity.** The claim throws *before* inserting a
  row, so a run blocked on capacity holds no `jm_sandbox_instances` row. It does,
  however, occupy a Conductor worker slot while it waits in-process — the same
  trade-off the image-not-ready loop already makes. Active runs free slots as
  they finish (`destroyed`), so the queue drains.
- **No bypass path.** `claimSandboxInstance` (via `ensureWorkspace`) is the only
  live insert into `jm_sandbox_instances`; `recordSandboxInstance` is unused in
  production. One gate covers everything.
- **No-pool / local-dev** keeps provisioning unconditionally (the `claim` dep
  returns `true` when there is no pool), so the limit is a no-op without a DB.
- **Lowering the limit below the live count** never kills running instances —
  new claims simply wait until the count drops below the new limit.
- **Limit is read fresh per run** (`resolveSandbox` fetches it at each
  provisioning), so changes apply to subsequent claims with no stale caching.
- **Pre-migration instance rows** have `sandbox_id = NULL` and are not counted
  for any sandbox (transient under-count; they drain as those runs finish).
- **Deleted sandbox with live instances** → orphaned `sandbox_id` (no FK); the
  count is unaffected, no new claims arrive, and reapers still tear down by
  `run_id`.
- **`hashtext` lock-key collisions** between two `sandbox_id`s cause only a rare,
  harmless extra serialization — never an incorrect count.

## Testing

- **Store:** under limit → admits (`inserted=1` → `true`); at limit + new run →
  throws `SandboxAtCapacityError` (`inserted=0, run_exists=false`); at limit but
  run row already exists → returns `false`, not a throw (`run_exists=true`,
  lost-race path); `limit = 0/null` takes the fast path and never counts;
  two concurrent claims for the last slot → exactly one wins (advisory lock).
- **`ensureWorkspace`:** passes `sandboxId`/`limit` to `claim`; propagates
  `SandboxAtCapacityError`; `claim=false` still routes to `waitActive`; skips the
  gate on the reconnect (active/provisioning) early-return.
- **worker-harness:** the in-process loop retries on `SandboxAtCapacityError`
  (re-calls `ensureWorkspace`) and stops on `abort`; after the retry budget is
  exhausted it completes the task as `FAILED` with a `sandbox_at_capacity`
  step.failed event.
- **Slot freeing:** `ProvisioningReaper.failRun` marks the instance destroyed
  (slot freed); `ensureWorkspace` releases the claim when `provision()` throws.
- **Retry after release:** after `releaseSandboxClaim` DELETEs the row, a fresh
  `ensureWorkspace` for the same run re-claims cleanly (no `ON CONFLICT`
  dead-lock); `releaseSandboxClaim` never deletes a row with a non-empty handle.
- **Validation:** `validateMaxConcurrentInstances` rejects negatives,
  non-integers, and out-of-range values; accepts `null`/`0`; runs on both POST
  and PATCH. Clearing via `null` round-trips through `updateSandbox`.
- **API/UI:** create and edit both persist the field; empty input clears it.
- **Migration:** applies cleanly; new columns nullable; `sandbox_id` is uuid;
  index created.
