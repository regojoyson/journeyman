# Sandbox Concurrency Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional per-sandbox "max concurrent instances" cap that makes new runs wait-and-retry when a sandbox is full, instead of overloading the host.

**Architecture:** A single DB-backed gate in `ensureWorkspace` claims a sandbox slot via one advisory-locked SQL statement (count + conditional insert). When full it throws `SandboxAtCapacityError`, which the worker-harness in-process loop retries (moderate budget) before failing over to a Conductor re-queue. The limit is a generic top-level field on the `Sandbox` record, surfaced through `resolveSandbox`.

**Tech Stack:** TypeScript (Node, ESM, `.ts` imports), PostgreSQL via `pg` (no ORM), Fastify routes, React + Tailwind UI, Vitest tests.

**Session constraints (from the requester):**
- **No commits.** Do not `git commit` or `git push`. The commit steps in the standard template are intentionally omitted.
- **Stay on `master`.** No new branch, no worktree.
- **Typecheck at the end.** A single `npm run check` + targeted `npm test` runs in the final task, not per-task.

**TDD note:** Tasks for pure/unit-testable code (types-free logic in `sandbox`, `resolver`, `ensure-workspace`, `step-timeouts`) follow test-first. Wiring tasks (`cli-worker`, `worker-harness` loop, routes, web UI) are validated by the final typecheck + targeted tests + review, mirroring how the existing `ImageNotReadyError` path is structured.

---

## File Structure

**Core types (`@journeyman/core`)**
- Modify `packages/core/src/types/sandbox.types.ts` — add `maxConcurrentInstances` to `Sandbox`, `CreateSandboxArgs`, `UpdateSandboxArgs`.
- Modify `packages/core/src/types/execution-environment.types.ts` — add `maxConcurrentInstances` to `ResolvedSandbox`.

**Migration**
- Create `packages/migrations/src/sql/065_sandbox_concurrency_limit.sql`.

**Sandbox package (`@journeyman/sandbox`)**
- Modify `packages/sandbox/src/sandbox-record.ts` — `validateMaxConcurrentInstances`, `validateSandboxInput`, `rowToSandbox`.
- Modify `packages/sandbox/src/db.ts` — `COLS`, `insertSandbox`, `updateSandbox`.
- Modify `packages/sandbox/src/resolver.ts` — `toResolved`.
- Modify `packages/sandbox/src/sandbox-instance-store.ts` — `SandboxAtCapacityError`, `claimSandboxInstanceWithCapacity`, `releaseSandboxClaim`, `claimSandboxInstance` (+`sandbox_id`).
- Modify `packages/sandbox/src/index.ts` — export the new symbols.
- Modify `packages/sandbox/src/routes/index.ts` — POST/PATCH pass + validate the field.

**Orchestrator (`@journeyman/orchestrator`)**
- Modify `packages/orchestrator/src/workers/step-timeouts.ts` — `resolveCapacityRetryConfig` + backstop sizing.
- Modify `packages/orchestrator/src/sandbox/ensure-workspace.ts` — deps, gated claim, releaseClaim.
- Modify `packages/orchestrator/src/workers/worker-harness.ts` — in-process capacity retry + outer-catch branch.
- Modify `packages/orchestrator/src/cli-worker.ts` — wire the gated claim, releaseClaim, and the limit.

**API server (`@journeyman/api-server`)**
- Modify `packages/api-server/src/composition.ts` — `ProvisioningReaper.failRun` frees the slot.

**Web (`@journeyman/web`)**
- Modify `packages/web/src/api/sandboxes.ts` — `Sandbox` + `SandboxUpsertBody`.
- Modify `packages/web/src/components/sandboxes/SandboxFormModal.tsx` — number input + body/patch.

---

## Task 1: Core types

**Files:**
- Modify: `packages/core/src/types/sandbox.types.ts`
- Modify: `packages/core/src/types/execution-environment.types.ts`

- [ ] **Step 1: Add the field to `Sandbox`**

In `packages/core/src/types/sandbox.types.ts`, inside `interface Sandbox`, add after `imageBuiltAt: Date | null;`:

```typescript
  /** Max concurrent provisioning+active instances for this sandbox. null/0 = unlimited. */
  maxConcurrentInstances?: number | null;
```

- [ ] **Step 2: Add the field to `CreateSandboxArgs` and `UpdateSandboxArgs`**

In the same file, add to `interface CreateSandboxArgs` (after `enabled?: boolean;`) and to `interface UpdateSandboxArgs` (after `enabled?: boolean;`):

```typescript
  maxConcurrentInstances?: number | null;
```

- [ ] **Step 3: Add the field to `ResolvedSandbox`**

In `packages/core/src/types/execution-environment.types.ts`, inside `interface ResolvedSandbox`, add after `imageError?: string | null;`:

```typescript
  /** Max concurrent instances for this sandbox (host-capacity cap). null/0 = unlimited. */
  maxConcurrentInstances?: number | null;
```

---

## Task 2: Migration

**Files:**
- Create: `packages/migrations/src/sql/065_sandbox_concurrency_limit.sql`

- [ ] **Step 1: Write the migration**

Create `packages/migrations/src/sql/065_sandbox_concurrency_limit.sql`:

```sql
-- Per-sandbox concurrency limit + per-sandbox instance attribution.

-- The cap. NULL = unlimited (the default for all existing rows).
ALTER TABLE jm_sandboxes
  ADD COLUMN IF NOT EXISTS max_concurrent_instances integer;

-- Which sandbox an instance belongs to, so we can count per sandbox record
-- (not per type). uuid to match jm_sandboxes.id; nullable, no FK — instances
-- may outlive their sandbox, and pre-existing rows stay NULL and drain out.
ALTER TABLE jm_sandbox_instances
  ADD COLUMN IF NOT EXISTS sandbox_id uuid;

-- Speeds up the per-sandbox capacity count (sandbox_id + status filter).
CREATE INDEX IF NOT EXISTS idx_jm_sandbox_instances_sandbox_status
  ON jm_sandbox_instances (sandbox_id, status);
```

- [ ] **Step 2: Verify the file is picked up**

Run: `ls packages/migrations/src/sql/ | tail -3`
Expected: `065_sandbox_concurrency_limit.sql` is listed after `064_token_usage.sql`. (Do **not** run `npm run migrate` — DB execution is out of scope for this session.)

---

## Task 3: Validation + row mapping (`sandbox-record.ts`)

**Files:**
- Modify: `packages/sandbox/src/sandbox-record.ts`
- Test: `packages/sandbox/src/sandbox-record.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/sandbox/src/sandbox-record.test.ts`, add:

```typescript
import { validateMaxConcurrentInstances, rowToSandbox } from "./sandbox-record.ts";

describe("validateMaxConcurrentInstances", () => {
  it("accepts undefined, null, 0, and positive integers", () => {
    expect(() => validateMaxConcurrentInstances(undefined)).not.toThrow();
    expect(() => validateMaxConcurrentInstances(null)).not.toThrow();
    expect(() => validateMaxConcurrentInstances(0)).not.toThrow();
    expect(() => validateMaxConcurrentInstances(5)).not.toThrow();
    expect(() => validateMaxConcurrentInstances(10000)).not.toThrow();
  });

  it("rejects negatives, non-integers, non-numbers, and out-of-range", () => {
    expect(() => validateMaxConcurrentInstances(-1)).toThrow();
    expect(() => validateMaxConcurrentInstances(1.5)).toThrow();
    expect(() => validateMaxConcurrentInstances("5")).toThrow();
    expect(() => validateMaxConcurrentInstances(10001)).toThrow();
    expect(() => validateMaxConcurrentInstances(NaN)).toThrow();
  });
});

describe("rowToSandbox maxConcurrentInstances", () => {
  it("maps the column, defaulting to null", () => {
    expect(rowToSandbox({ max_concurrent_instances: 3 }).maxConcurrentInstances).toBe(3);
    expect(rowToSandbox({}).maxConcurrentInstances).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace @journeyman/sandbox -- sandbox-record`
Expected: FAIL — `validateMaxConcurrentInstances is not a function` / `maxConcurrentInstances` undefined.

- [ ] **Step 3: Implement the validator and wire it in**

In `packages/sandbox/src/sandbox-record.ts`:

a) Add `maxConcurrentInstances?: unknown;` to `interface SandboxInputShape`.

b) Add this exported function above `validateSandboxInput`:

```typescript
/** Validate an optional per-sandbox concurrency cap. null/0 = unlimited. Throws InvalidSandboxInputError. */
export function validateMaxConcurrentInstances(v: unknown): void {
  if (v === undefined || v === null) return;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 10000) {
    throw new InvalidSandboxInputError(
      `maxConcurrentInstances must be an integer between 0 and 10000 (got ${String(v)})`,
    );
  }
}
```

c) At the end of `validateSandboxInput` (after the catalog block), add:

```typescript
  validateMaxConcurrentInstances(input.maxConcurrentInstances);
```

d) In `rowToSandbox`, add after `imageBuiltAt: r.image_built_at ?? null,`:

```typescript
    maxConcurrentInstances: r.max_concurrent_instances ?? null,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @journeyman/sandbox -- sandbox-record`
Expected: PASS.

---

## Task 4: Store columns (`db.ts`)

**Files:**
- Modify: `packages/sandbox/src/db.ts`
- Test: `packages/sandbox/src/db.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/sandbox/src/db.test.ts`, add a block (adjust the `fakeDb`/import to match the file's existing helper — it uses a `{ query }` stub that records calls and returns canned rows):

```typescript
import { insertSandbox, updateSandbox } from "./db.ts";

describe("db maxConcurrentInstances wiring", () => {
  it("insertSandbox sends max_concurrent_instances as the last value", async () => {
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const db = { async query(text: string, params?: unknown[]) { calls.push({ text, params }); return { rows: [{}] }; } };
    await insertSandbox(db, {
      scope: "org", orgId: "o1", name: "n", type: "docker",
      executionMode: "per-instance", createdBy: "u1", maxConcurrentInstances: 4,
    });
    expect(calls[0].text).toMatch(/max_concurrent_instances/);
    expect(calls[0].params).toContain(4);
  });

  it("updateSandbox sets the column only when provided", async () => {
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const db = { async query(text: string, params?: unknown[]) { calls.push({ text, params }); return { rows: [{ id: "x" }] }; } };
    await updateSandbox(db, { id: "x", orgId: "o1", maxConcurrentInstances: null });
    expect(calls[0].text).toMatch(/max_concurrent_instances = \$1/);
    expect(calls[0].params?.[0]).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace @journeyman/sandbox -- db.test`
Expected: FAIL — column not present in SQL.

- [ ] **Step 3: Implement the column wiring**

In `packages/sandbox/src/db.ts`:

a) Append `max_concurrent_instances` to the `COLS` constant (end of the column list):

```typescript
const COLS =
  "id, scope, org_id, name, type, execution_mode, connectivity, config, tags, enabled, created_by, created_at, updated_at, image_state, image_fingerprint, image_ref, image_error, image_built_at, max_concurrent_instances";
```

b) In `insertSandbox`, change the column list, the `VALUES` placeholders, and the params array to include the new column:

```typescript
  const { rows } = await db.query(
    `INSERT INTO jm_sandboxes
       (scope, org_id, name, type, execution_mode, connectivity, config, tags, enabled, created_by, max_concurrent_instances)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)
     RETURNING ${COLS}`,
    [
      input.scope, input.orgId, input.name, input.type, input.executionMode,
      input.connectivity ?? null, JSON.stringify(input.config ?? {}),
      JSON.stringify(input.tags ?? []), input.enabled ?? true, input.createdBy,
      input.maxConcurrentInstances ?? null,
    ],
  );
```

c) In `updateSandbox`, add a `set()` branch alongside the others (after the `enabled` branch):

```typescript
  if (input.maxConcurrentInstances !== undefined) set("max_concurrent_instances", input.maxConcurrentInstances);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @journeyman/sandbox -- db.test`
Expected: PASS.

---

## Task 5: Resolver (`resolver.ts`)

**Files:**
- Modify: `packages/sandbox/src/resolver.ts`

- [ ] **Step 1: Surface the field in `toResolved`**

In `packages/sandbox/src/resolver.ts`, inside `toResolved`, add after `imageError: w.imageError,`:

```typescript
    maxConcurrentInstances: w.maxConcurrentInstances ?? null,
```

(No dedicated test — covered by the final typecheck and by `ensure-workspace` tests in Task 8.)

---

## Task 6: Capacity claim + release (`sandbox-instance-store.ts`)

**Files:**
- Modify: `packages/sandbox/src/sandbox-instance-store.ts`
- Test: `packages/sandbox/src/sandbox-instance-store.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/sandbox/src/sandbox-instance-store.test.ts`, add (reuse the file's existing `fakeDb` helper that returns canned `rows`):

```typescript
import {
  claimSandboxInstanceWithCapacity, releaseSandboxClaim, SandboxAtCapacityError, claimSandboxInstance,
} from "./sandbox-instance-store.ts";

describe("claimSandboxInstanceWithCapacity", () => {
  const base = { runId: "r1", type: "docker", owner: "o1", sandboxId: "s1" };

  it("no limit → fast path (plain claim SQL, no advisory lock)", async () => {
    const db = fakeDb([{ run_id: "r1" }]);
    const won = await claimSandboxInstanceWithCapacity(db, { ...base, limit: null });
    expect(won).toBe(true);
    expect(db.calls[0].text).not.toMatch(/pg_advisory_xact_lock/);
    expect(db.calls[0].text).toMatch(/insert into jm_sandbox_instances/i);
  });

  it("under limit → admits (inserted=1)", async () => {
    const db = fakeDb([{ inserted: 1, run_exists: true }]);
    expect(await claimSandboxInstanceWithCapacity(db, { ...base, limit: 5 })).toBe(true);
    expect(db.calls[0].text).toMatch(/pg_advisory_xact_lock/);
  });

  it("at limit + new run → throws SandboxAtCapacityError", async () => {
    const db = fakeDb([{ inserted: 0, run_exists: false }]);
    await expect(claimSandboxInstanceWithCapacity(db, { ...base, limit: 5 }))
      .rejects.toBeInstanceOf(SandboxAtCapacityError);
  });

  it("row already exists (lost race / parallel branch) → false, not a throw", async () => {
    const db = fakeDb([{ inserted: 0, run_exists: true }]);
    expect(await claimSandboxInstanceWithCapacity(db, { ...base, limit: 5 })).toBe(false);
  });
});

describe("releaseSandboxClaim", () => {
  it("deletes only an un-provisioned provisioning row", async () => {
    const db = fakeDb([]);
    await releaseSandboxClaim(db, "r1");
    expect(db.calls[0].text).toMatch(/delete from jm_sandbox_instances/i);
    expect(db.calls[0].text).toMatch(/status = 'provisioning'/i);
    expect(db.calls[0].text).toMatch(/handle = ''/);
    expect(db.calls[0].params).toEqual(["r1"]);
  });
});

describe("claimSandboxInstance sandbox_id", () => {
  it("includes sandbox_id in the insert params", async () => {
    const db = fakeDb([{ run_id: "r1" }]);
    await claimSandboxInstance(db, { runId: "r1", type: "docker", owner: "o1", sandboxId: "s1" });
    expect(db.calls[0].text).toMatch(/sandbox_id/);
    expect(db.calls[0].params).toEqual(["r1", "docker", "o1", "s1"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace @journeyman/sandbox -- sandbox-instance-store`
Expected: FAIL — functions/error not exported.

- [ ] **Step 3: Implement the error, the gated claim, and release**

In `packages/sandbox/src/sandbox-instance-store.ts`:

a) Add the error class near the top (after the imports):

```typescript
/** Thrown by claimSandboxInstanceWithCapacity when the sandbox is at its concurrency limit. */
export class SandboxAtCapacityError extends Error {
  constructor(message = "sandbox at capacity") {
    super(message);
    this.name = "SandboxAtCapacityError";
  }
}
```

b) Replace `claimSandboxInstance` so it records `sandbox_id`:

```typescript
export async function claimSandboxInstance(
  db: Queryable,
  row: { runId: string; type: string; owner: string; sandboxId?: string | null },
): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO jm_sandbox_instances (run_id, type, handle, status, owner, sandbox_id)
     VALUES ($1, $2, '', 'provisioning', $3, $4)
     ON CONFLICT (run_id) DO NOTHING
     RETURNING run_id`,
    [row.runId, row.type, row.owner, row.sandboxId ?? null],
  );
  return r.rows.length > 0;
}
```

c) Add the capacity-gated claim below it:

```typescript
/**
 * Claim a sandbox slot atomically. With no limit, delegates to claimSandboxInstance
 * (lock-free). With a limit, a single advisory-locked statement counts active+
 * provisioning rows for the sandbox and inserts only if under the cap.
 *
 * Returns true if THIS caller won the claim, false if another worker already
 * holds this run (caller should waitActive). Throws SandboxAtCapacityError when
 * the sandbox is full.
 */
export async function claimSandboxInstanceWithCapacity(
  db: Queryable,
  row: { runId: string; type: string; owner: string; sandboxId: string; limit: number | null },
): Promise<boolean> {
  if (row.limit == null || row.limit <= 0) {
    return claimSandboxInstance(db, row);
  }
  const { rows } = await db.query(
    `WITH lk AS (
       SELECT pg_advisory_xact_lock(hashtext('jm_sbx_cap:' || $4::text)) AS locked
     ),
     cap AS (
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
            EXISTS (SELECT 1 FROM jm_sandbox_instances WHERE run_id = $1) AS run_exists`,
    [row.runId, row.type, row.owner, row.sandboxId, row.limit],
  );
  const inserted = Number(rows[0]?.inserted ?? 0);
  const runExists = Boolean(rows[0]?.run_exists);
  if (inserted > 0) return true;       // won the claim
  if (runExists) return false;         // another worker holds this run → waitActive
  throw new SandboxAtCapacityError();  // blocked by capacity
}

/**
 * Release an un-provisioned claim (provision failed before reaching 'active').
 * DELETEs the row so the slot frees immediately AND a Conductor retry can
 * re-claim cleanly. The handle='' guard guarantees we never remove a live unit.
 */
export async function releaseSandboxClaim(db: Queryable, runId: string): Promise<void> {
  await db.query(
    `DELETE FROM jm_sandbox_instances
       WHERE run_id = $1 AND status = 'provisioning' AND handle = ''`,
    [runId],
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @journeyman/sandbox -- sandbox-instance-store`
Expected: PASS.

---

## Task 7: Exports (`sandbox/index.ts`)

**Files:**
- Modify: `packages/sandbox/src/index.ts`

- [ ] **Step 1: Export the new store symbols**

In `packages/sandbox/src/index.ts`, extend the `sandbox-instance-store.ts` export block:

```typescript
export {
  recordSandboxInstance, getSandboxInstance, markSandboxInstanceDestroyed, listActiveSandboxInstances,
  claimSandboxInstance, claimSandboxInstanceWithCapacity, releaseSandboxClaim, SandboxAtCapacityError,
  markSandboxInstanceActive,
} from "./sandbox-instance-store.ts";
```

- [ ] **Step 2: Export the validator** (used by the PATCH route in Task 12)

Confirm `validateMaxConcurrentInstances` is reachable. The routes import from `../sandbox-record.ts` directly (see Task 12), so no index change is needed for it — but verify `sandbox-record.ts` exports it (done in Task 3b).

---

## Task 8: Gated claim in `ensureWorkspace`

**Files:**
- Modify: `packages/orchestrator/src/sandbox/ensure-workspace.ts`
- Test: `packages/orchestrator/src/sandbox/ensure-workspace.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/orchestrator/src/sandbox/ensure-workspace.test.ts`, add `releaseClaim: vi.fn().mockResolvedValue(undefined)` to the `baseDeps` object, and add these cases inside the describe block:

```typescript
  it("passes sandboxId and limit to claim", async () => {
    const { registry } = fakeRegistry();
    const deps = baseDeps(registry, {
      resolveSandbox: vi.fn().mockResolvedValue({ id: "w1", type: "docker", config: {}, maxConcurrentInstances: 3 }),
    });
    await ensureWorkspace(deps as never, args);
    expect(deps.claim).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "r", sandboxId: "w1", limit: 3 }),
    );
  });

  it("propagates SandboxAtCapacityError from claim", async () => {
    const { registry } = fakeRegistry();
    const err = Object.assign(new Error("full"), { name: "SandboxAtCapacityError" });
    const deps = baseDeps(registry, { claim: vi.fn().mockRejectedValue(err) });
    await expect(ensureWorkspace(deps as never, args)).rejects.toMatchObject({ name: "SandboxAtCapacityError" });
  });

  it("releases the claim when provision() fails", async () => {
    const { registry } = fakeRegistry({ provision: () => { throw new Error("boom"); } });
    const deps = baseDeps(registry, {});
    await expect(ensureWorkspace(deps as never, args)).rejects.toThrow("boom");
    expect(deps.releaseClaim).toHaveBeenCalledWith("r");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace @journeyman/orchestrator -- ensure-workspace`
Expected: FAIL — claim called without `sandboxId`/`limit`; `releaseClaim` not called.

- [ ] **Step 3: Update the deps interface and the claim/release calls**

In `packages/orchestrator/src/sandbox/ensure-workspace.ts`:

a) Change the `claim` signature in `EnsureWorkspaceDeps` and add `releaseClaim`:

```typescript
  claim(row: {
    runId: string; type: string; owner: string; sandboxId: string; limit: number | null;
  }): Promise<boolean>;
  /** Delete an un-provisioned claim row so a failed provision frees its slot. */
  releaseClaim(runId: string): Promise<void>;
```

b) In `EnsureWorkspaceDeps.resolveSandbox`'s return type, add after `imageError?: string | null;`:

```typescript
    maxConcurrentInstances?: number | null;
```

c) Replace the `claim` call (currently `deps.claim({ runId: args.runId, type: worker.type, owner: args.orgId })`) with:

```typescript
  const won = await deps.claim({
    runId: args.runId,
    type: worker.type,
    owner: args.orgId,
    sandboxId: worker.id,
    limit: worker.maxConcurrentInstances ?? null,
  });
```

d) In the `try/catch` around `env.provision(...)`, change the catch to release the claim before rethrowing:

```typescript
  } catch (err) {
    log(`Workspace provisioning failed: ${(err as Error).message}`);
    await deps.releaseClaim(args.runId).catch(() => {});
    throw err;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @journeyman/orchestrator -- ensure-workspace`
Expected: PASS.

---

## Task 9: Capacity retry config (`step-timeouts.ts`)

**Files:**
- Modify: `packages/orchestrator/src/workers/step-timeouts.ts`
- Test: `packages/orchestrator/src/workers/step-timeouts.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/orchestrator/src/workers/step-timeouts.test.ts`, add:

```typescript
import { resolveCapacityRetryConfig } from "./step-timeouts.ts";

describe("resolveCapacityRetryConfig", () => {
  it("defaults to a moderate budget", () => {
    expect(resolveCapacityRetryConfig({})).toEqual({ attempts: 5, delayMs: 10_000 });
  });
  it("reads env overrides", () => {
    expect(resolveCapacityRetryConfig({
      SANDBOX_CAPACITY_RETRY_ATTEMPTS: "2", SANDBOX_CAPACITY_RETRY_DELAY_MS: "1000",
    } as NodeJS.ProcessEnv)).toEqual({ attempts: 2, delayMs: 1000 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace @journeyman/orchestrator -- step-timeouts`
Expected: FAIL — `resolveCapacityRetryConfig is not a function`.

- [ ] **Step 3: Implement the config + fold it into the Conductor backstop**

In `packages/orchestrator/src/workers/step-timeouts.ts`:

a) Add defaults near the other `DEFAULT_*` constants:

```typescript
/** Default in-process capacity-wait retry attempts (moderate — long waits pin the serial worker). */
export const DEFAULT_CAPACITY_RETRY_ATTEMPTS = 5;
/** Default delay (ms) between capacity-wait retries. */
export const DEFAULT_CAPACITY_RETRY_DELAY_MS = 10_000;
```

b) Add the resolver after `resolveImageRetryConfig`:

```typescript
/** In-process capacity-wait retry config (attempts may be 0 to fast-fail to Conductor re-queue). */
export function resolveCapacityRetryConfig(
  env: NodeJS.ProcessEnv = process.env,
): { attempts: number; delayMs: number } {
  return {
    attempts: num(env.SANDBOX_CAPACITY_RETRY_ATTEMPTS, DEFAULT_CAPACITY_RETRY_ATTEMPTS, 0),
    delayMs: num(env.SANDBOX_CAPACITY_RETRY_DELAY_MS, DEFAULT_CAPACITY_RETRY_DELAY_MS, 0),
  };
}

/** Worst-case time (s) the worker may spend waiting for a free sandbox slot. */
export function resolveCapacityWaitBudgetSeconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const { attempts, delayMs } = resolveCapacityRetryConfig(env);
  return Math.ceil((attempts * delayMs) / 1000);
}
```

c) In `resolveConductorTaskTimeoutSeconds`, include the capacity budget so Conductor never times out a run that is legitimately waiting for a slot. Change the final return:

```typescript
  return step + resolveImageWaitBudgetSeconds(env) + resolveCapacityWaitBudgetSeconds(env) + margin;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace @journeyman/orchestrator -- step-timeouts`
Expected: PASS.

---

## Task 10: Worker-harness wait + fail-over

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`

- [ ] **Step 1: Import the capacity config**

In the import from `./step-timeouts.ts` (currently `resolveDefaultStepTimeoutSeconds, resolveImageRetryConfig`), add `resolveCapacityRetryConfig`:

```typescript
import { resolveDefaultStepTimeoutSeconds, resolveImageRetryConfig, resolveCapacityRetryConfig } from "./step-timeouts.ts";
```

- [ ] **Step 2: Add a separate capacity counter beside the image counter**

Just after the existing line `const { attempts: imageRetryAttempts, delayMs: imageRetryDelayMs } = resolveImageRetryConfig();` and `let imageAttempt = 0;`, add:

```typescript
        const { attempts: capacityRetryAttempts, delayMs: capacityRetryDelayMs } = resolveCapacityRetryConfig();
        let capacityAttempt = 0;
```

- [ ] **Step 3: Retry capacity in the in-process loop**

In the `catch (err: any)` block inside the `while (true)` provisioning loop, add this branch immediately **before** the existing `if (err?.name === "ImageNotReadyError" ...)` branch:

```typescript
            if (err?.name === "SandboxAtCapacityError" && capacityAttempt < capacityRetryAttempts) {
              capacityAttempt++;
              const msg = `⏳ sandbox at capacity; waiting for a free slot (attempt ${capacityAttempt}/${capacityRetryAttempts})…`;
              rlog.info({ sandboxId, attempt: capacityAttempt }, "waiting for capacity");
              await provisionLog(msg);
              await delayOrAbort(capacityRetryDelayMs, abort.signal);
              continue;
            }
```

- [ ] **Step 4: Add the outer-catch fail-over branch**

In the outer `catch (err: any)` (the one with the `ImageNotReadyError` / `TimeoutError` / `ConfigurationError` branches), add this branch immediately **after** the `ImageNotReadyError` branch:

```typescript
      if (err?.name === "SandboxAtCapacityError") {
        rlog.info({ message: err.message, durationMs }, "sandbox at capacity; failing for re-queue");
        await this.deps.events.append({
          workflowInstanceId, nodeId, eventType: "step.log",
          payload: { line: `⚠ sandbox at capacity: ${err.message}; will retry if a retry policy is set` },
        }).catch(() => {});
        await appendStepEvent(this.deps.events, ctx, "step.failed", {
          reason: "sandbox_at_capacity",
          error: serializeError(err),
          tail: tail.drain(),
          durationMs,
        });
        await this.deps.client.completeTask({
          workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
          status: "FAILED",
          reasonForIncompletion: `sandbox_at_capacity: ${err.message}`,
        });
        return;
      }
```

- [ ] **Step 5: Verify the file typechecks (no isolated test)**

Run: `npm run typecheck --workspace @journeyman/orchestrator`
Expected: no errors. (The loop behavior is exercised end-to-end; the config is unit-tested in Task 9. This mirrors how the `ImageNotReadyError` path is structured — no isolated harness unit test.)

---

## Task 11: Wire the worker (`cli-worker.ts`)

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Import the new store functions**

In the import from `@journeyman/sandbox` (the line with `getSandboxInstance, claimSandboxInstance, markSandboxInstanceActive, resolveSandbox`), add `claimSandboxInstanceWithCapacity, releaseSandboxClaim`:

```typescript
  makeDockerClient, getSandboxInstance, claimSandboxInstance, claimSandboxInstanceWithCapacity,
  releaseSandboxClaim, markSandboxInstanceActive, resolveSandbox,
```

- [ ] **Step 2: Swap the claim dep and add releaseClaim**

In the `ensureWorkspace({ ... })` deps object, replace the `claim:` line and add `releaseClaim:` right after it:

```typescript
      claim: (row) => (pool ? claimSandboxInstanceWithCapacity(pool, row) : Promise.resolve(true)),
      releaseClaim: (id) => (pool ? releaseSandboxClaim(pool, id) : Promise.resolve()),
```

- [ ] **Step 3: Surface the limit from resolveSandbox**

In the `resolveSandbox` dep's pool branch, add `maxConcurrentInstances` to the returned object (after `imageError: w.imageError,`):

```typescript
            maxConcurrentInstances: w.maxConcurrentInstances,
```

The no-pool branch (`return { id: "local", type: "local" as const, config: {} };`) is left unchanged — `maxConcurrentInstances` is simply absent (treated as unlimited), and `claim` returns `true` there anyway.

- [ ] **Step 4: Verify it typechecks**

Run: `npm run typecheck --workspace @journeyman/orchestrator`
Expected: no errors (the `claim` dep's row type now matches `claimSandboxInstanceWithCapacity`).

---

## Task 12: Free the slot on stuck provisioning (`composition.ts`)

**Files:**
- Modify: `packages/api-server/src/composition.ts`

- [ ] **Step 1: Mark the instance destroyed in `failRun`**

In `packages/api-server/src/composition.ts`, in the `ProvisioningReaper`'s `failRun` callback, add the instance teardown after `workflowInstances.setStatus(...)`:

```typescript
      failRun: async (id) => {
        await events
          .append({ workflowInstanceId: id, eventType: "step.log", payload: { line: "Run failed: sandbox provisioning timed out" } })
          .catch(() => undefined);
        await workflowInstances.setStatus(id, "failed", { completedAt: new Date() });
        await markSandboxInstanceDestroyed(pool!, id).catch(() => undefined);
      },
```

(`markSandboxInstanceDestroyed` is already imported at the top of this file.)

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck --workspace @journeyman/api-server`
Expected: no errors.

---

## Task 13: Routes accept + validate the field

**Files:**
- Modify: `packages/sandbox/src/routes/index.ts`

- [ ] **Step 1: Import the field validator**

In `packages/sandbox/src/routes/index.ts`, extend the import from `../sandbox-record.ts`:

```typescript
import { validateSandboxInput, validateMaxConcurrentInstances, InvalidSandboxInputError } from "../sandbox-record.ts";
```

- [ ] **Step 2: Pass the field on create (POST)**

In the POST handler's `insertSandbox({ ... })` call, add (after `enabled: body.enabled ?? true,`):

```typescript
        maxConcurrentInstances: body.maxConcurrentInstances ?? null,
```

(`validateSandboxInput(body)` already validates it via Task 3.)

- [ ] **Step 3: Validate + pass the field on update (PATCH)**

Replace the PATCH handler body (the `const ok = await updateSandbox(...)` block) with a validated version:

```typescript
    const body = req.body as any;
    try {
      validateMaxConcurrentInstances(body.maxConcurrentInstances);
    } catch (err) {
      if (err instanceof InvalidSandboxInputError) return reply.code(400).send({ error: err.message });
      throw err;
    }
    const ok = await updateSandbox(pool, {
      id, orgId, name: body.name, executionMode: body.executionMode,
      connectivity: body.connectivity, config: body.config,
      tags: body.tags, enabled: body.enabled,
      maxConcurrentInstances: body.maxConcurrentInstances,
    });
```

- [ ] **Step 4: Verify it typechecks**

Run: `npm run typecheck --workspace @journeyman/sandbox`
Expected: no errors.

---

## Task 14: Web API client types

**Files:**
- Modify: `packages/web/src/api/sandboxes.ts`

- [ ] **Step 1: Add the field to both interfaces**

In `packages/web/src/api/sandboxes.ts`:

a) In `interface Sandbox`, add after `imageError?: string | null;`:

```typescript
  maxConcurrentInstances?: number | null;
```

b) In `interface SandboxUpsertBody`, add after `enabled?: boolean;`:

```typescript
  maxConcurrentInstances?: number | null;
```

---

## Task 15: Web form input (`SandboxFormModal.tsx`)

**Files:**
- Modify: `packages/web/src/components/sandboxes/SandboxFormModal.tsx`

- [ ] **Step 1: Import a number icon**

In the `lucide-react` import, add `Gauge`:

```typescript
import { Info, Tag, Server, Gauge } from "lucide-react";
```

- [ ] **Step 2: Add form state**

After the `const [name, setName] = useState(...)` line, add:

```typescript
  const [maxConcurrent, setMaxConcurrent] = useState<string>(
    props.worker?.maxConcurrentInstances != null ? String(props.worker.maxConcurrentInstances) : "",
  );
```

- [ ] **Step 3: Include the field in both upsert bodies**

In `submit`, where the `body` object is built, add to the `SandboxUpsertBody` literal (after `config: builtConfig,`):

```typescript
      maxConcurrentInstances: maxConcurrent.trim() === "" ? null : Number(maxConcurrent),
```

And in the edit `patch` object (the `Partial<SandboxUpsertBody>`), add (after `config: body.config,`):

```typescript
          maxConcurrentInstances: body.maxConcurrentInstances,
```

- [ ] **Step 4: Render the input**

Immediately after the Type `<Field>...</Field>` block (before the `{ConfigForm ...}` block), add:

```tsx
          <Field icon={Gauge} label="Max concurrent instances"
            hint={<>Most runs that may use this sandbox at once. Leave blank for no limit.</>}>
            <input className={inputCls} type="number" min={0} placeholder="No limit"
              value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} />
          </Field>
```

- [ ] **Step 5: Verify it typechecks**

Run: `npm run typecheck --workspace @journeyman/web`
Expected: no errors.

---

## Task 16: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full type + boundary check**

Run: `npm run check`
Expected: typecheck and import-boundary checks pass with no errors.

- [ ] **Step 2: Run the affected package tests**

Run: `npm test --workspace @journeyman/sandbox && npm test --workspace @journeyman/orchestrator`
Expected: all tests pass, including the new `sandbox-record`, `db`, `sandbox-instance-store`, `ensure-workspace`, and `step-timeouts` cases. (Per the deps campaign baseline, ignore the known pre-existing failures — confirm no *new* failures vs. that baseline.)

- [ ] **Step 3: Sanity-check the diff scope**

Run: `git status`
Expected: only the files listed in this plan's File Structure are modified/created. **Do not commit** (per session constraint) — leave the working tree for review.

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), migration (Task 2), validation incl. PATCH gap (Tasks 3, 13), `db.ts` COLS/insert/update (Task 4), resolver (Task 5), capacity claim + disambiguation + `releaseSandboxClaim` (Task 6), exports (Task 7), gated claim + release-on-provision-failure (Task 8), moderate budget + Conductor backstop (Task 9), in-process retry + fail-over (Task 10), worker wiring (Task 11), provisioning-reaper slot freeing (Task 12), routes (Task 13), web types + form incl. empty→null clearing (Tasks 14–15). System-scope sandboxes remain seed/CLI-only by design (documented in the spec; no UI task).
- **Type consistency:** `claimSandboxInstanceWithCapacity(db, { runId, type, owner, sandboxId, limit })` is defined in Task 6 and called with the identical shape by `ensureWorkspace` (Task 8) and `cli-worker` (Task 11). `releaseSandboxClaim(db, runId)` / `releaseClaim(runId)` match across Tasks 6, 8, 11. `maxConcurrentInstances` is the single field name across core, store, resolver, routes, and web.
- **No DB execution / no commits / master branch** — honored throughout; verification is typecheck + unit tests only.
