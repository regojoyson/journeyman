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

Enforce a single DB-backed gate in `ensureWorkspace`, atomic via a transaction
with a per-sandbox advisory lock. When a sandbox is at capacity, throw a
retryable `SandboxAtCapacityError` — the same wait-and-retry path the existing
`ImageNotReadyError` gate already uses (worker-harness catches it, completes the
Conductor task as `FAILED`, Conductor re-queues with backoff). The Conductor
retry loop *is* the queue.

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

ALTER TABLE jm_sandbox_instances
  ADD COLUMN sandbox_id text;

-- Speeds up the per-sandbox capacity count.
CREATE INDEX IF NOT EXISTS idx_jm_sandbox_instances_sandbox_status
  ON jm_sandbox_instances (sandbox_id, status);
```

`sandbox_id` is nullable: pre-existing instance rows stay `null` (they drain out
naturally), and every new claim records it. This column is what lets us count
instances **per sandbox record** rather than per `type`.

### Validation (`packages/sandbox/src/sandbox-record.ts`)

In `validateSandboxInput`: if `maxConcurrentInstances` is present, it must be an
integer `>= 0`; otherwise throw `InvalidSandboxInputError`.

## Counting + Atomic Gate

New store function in `sandbox-instance-store.ts`:

```ts
export async function claimSandboxInstanceWithCapacity(
  db: Queryable,
  row: { runId: string; type: string; owner: string; sandboxId: string; limit: number | null },
): Promise<boolean>
```

In **one transaction**:

1. `SELECT pg_advisory_xact_lock(hashtext($sandboxId))` — serializes capacity
   checks for the same sandbox so two workers can't both pass.
2. If `limit && limit > 0`: count rows where
   `sandbox_id = $sandboxId AND status IN ('provisioning','active')`.
   This is a **global** count (the `owner` column is ignored), modelling host
   capacity. In-flight `provisioning` rows count, so we never overshoot.
3. If `count >= limit` → `throw new SandboxAtCapacityError(...)`.
4. Else `INSERT INTO jm_sandbox_instances (run_id, type, handle, status, owner,
   sandbox_id) VALUES (..., 'provisioning', ...) ON CONFLICT (run_id) DO NOTHING
   RETURNING run_id`. Return `rows.length > 0` (true ⇒ this caller won the claim).

`SandboxAtCapacityError` is a named error class (`err.name =
"SandboxAtCapacityError"`) exported from the sandbox package.

`recordSandboxInstance` and `claimSandboxInstance` also begin persisting
`sandbox_id` (passed through from callers) for consistency.

## Wait-and-Retry Wiring

### `ensureWorkspace` (`packages/orchestrator/src/sandbox/ensure-workspace.ts`)

- Extend the `resolveSandbox` return shape with `maxConcurrentInstances`.
- Extend `EnsureWorkspaceDeps.claim` (or add a capacity-aware variant) to accept
  `{ runId, type, owner, sandboxId, limit }`.
- The `status === "active"` and `status === "provisioning"` early-returns stay
  **before** the gate, so a run already holding a slot is never re-gated on a
  later step (reconnect path).
- After `backend.checkRunnable`, call the capacity-aware claim. A
  `SandboxAtCapacityError` propagates up unchanged.

### `worker-harness.ts`

Add a branch mirroring `ImageNotReadyError`:

```ts
if (err?.name === "SandboxAtCapacityError") {
  // log "sandbox at capacity; retrying"
  // append step.log + step.failed (reason: "sandbox_at_capacity")
  // completeTask({ status: "FAILED", reasonForIncompletion: `sandbox_at_capacity: ${err.message}` })
  return;
}
```

`status: "FAILED"` ⇒ Conductor retries with its configured backoff. That is the
queue.

## Config Propagation

- `createSandbox` / `updateSandbox` (store + routes in `packages/sandbox`) read
  and write `max_concurrent_instances`.
- The resolver / `resolveSandbox` surfaces `maxConcurrentInstances` to
  `ensureWorkspace`.
- `SandboxUpsertBody` (web API client) gains `maxConcurrentInstances`.

## UI

A generic **"Max concurrent instances"** number input in the top, type-agnostic
section of `packages/web/src/components/sandboxes/SandboxFormModal.tsx` — not the
per-type config forms, since it applies to every type. Empty ⇒ unlimited, with
helper text ("Leave blank for no limit"). Flows into
`SandboxUpsertBody.maxConcurrentInstances`.

## Decisions / Edge Cases

- **Global, not per-org, count.** A limit of 5 on a system-scoped Docker sandbox
  means 5 total across all orgs — it models host capacity. (`owner` is ignored
  in the count.)
- **Reconnects don't re-gate.** The active/provisioning early-returns run before
  the gate, so a run already holding a slot never gets blocked on a later step.
- **Destroyed instances free slots immediately** — status flips to `destroyed`,
  excluded from the count. The existing reaper handles orphaned/leaked rows.
- **`limit = 0` / null / undefined ⇒ unlimited** — the gate is skipped entirely.

## Testing

- **Store:** capacity claim rejects at limit, admits under limit; advisory lock
  serializes two concurrent claims (only one wins the last slot); `limit = 0`
  skips counting.
- **`ensureWorkspace`:** throws `SandboxAtCapacityError` when full, proceeds when
  slots free, skips the gate on the reconnect (active/provisioning) path.
- **worker-harness:** `SandboxAtCapacityError` → task completed as `FAILED`
  (retryable), with a `sandbox_at_capacity` step.failed event.
- **Migration:** applies cleanly; new columns nullable; index created.
