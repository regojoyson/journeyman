# Webhook-Wait Max-Age Sweeper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an operator-controlled safety net that resolves any `webhook-wait` node paused longer than `JOURNEYMAN_WEBHOOK_WAIT_MAX_AGE` by firing its existing timeout branch.

**Architecture:** A small periodic sweeper (`setInterval`) registered in api-server composition runs SQL to find paused webhook-wait node executions older than the configured cap, then invokes the existing `resolveHumanTask({source: "timeout"})` path for each — same code that per-node timeouts already use. A new `resolved_by` column on `jm_human_task_resolutions` distinguishes sweeper-fired resolutions from natural ones for auditing.

**Tech Stack:** TypeScript, Node `setInterval`, Postgres, `pg`, existing Fastify api-server.

**Spec:** [docs/superpowers/specs/2026-05-25-webhook-wait-max-age-sweeper-design.md](docs/superpowers/specs/2026-05-25-webhook-wait-max-age-sweeper-design.md)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `packages/api-server/src/services/webhook-wait-sweeper.ts` | Sweeper class — `start()`, `stop()`, `tick()`. Pure logic; gets store + fire-handler injected. |
| Create | `packages/api-server/src/services/webhook-wait-sweeper.test.ts` | Unit tests for sweeper using memory store + spy fire-handler. |
| Create | `packages/api-server/src/services/parse-duration.ts` | Move `parseDurationMsLite` here so the sweeper and engine-reconciler share one parser. |
| Create | `packages/migrations/src/sql/029_resolved_by.sql` | Add nullable `resolved_by` column to `jm_human_task_resolutions`. |
| Modify | `packages/orchestrator/src/interfaces/workflow-instance-store.interface.ts` | Add `listOverAgePausedNodeExecutions(maxAgeMs, limit)` method. |
| Modify | `packages/orchestrator/src/stores/postgres/postgres-workflow-instance-store.ts` | Implement `listOverAgePausedNodeExecutions`. |
| Modify | `packages/orchestrator/src/stores/memory/memory-workflow-instance-store.ts` | Implement `listOverAgePausedNodeExecutions`. |
| Modify | `packages/api-server/src/services/resolve-human-task.ts` | Accept optional `resolvedBy: string` and pass it to `humanTaskResolutions.create`. |
| Modify | `packages/orchestrator/src/stores/human-task-resolution-store.ts` (or impl files) | Persist `resolved_by`; default null. |
| Modify | `packages/api-server/src/services/engine-reconciler.ts` | Replace inline `parseDurationMsLite` with import from `parse-duration.ts`; pass `resolvedBy: "node_timeout"` when firing per-node timeout. |
| Modify | `packages/api-server/src/composition.ts` | Read env vars, construct sweeper, wire into Composition. |
| Modify | `packages/api-server/src/server.ts` | Call `composition.webhookWaitSweeper.start()` after server up; `stop()` on SIGTERM. |

---

## Task 1: Extract `parseDurationMs` into a shared module

The sweeper needs to parse durations identically to per-node timeouts. Today `parseDurationMsLite` lives inline in `engine-reconciler.ts`. Move it to its own file so both call sites use the same implementation.

**Files:**
- Create: `packages/api-server/src/services/parse-duration.ts`
- Create: `packages/api-server/src/services/parse-duration.test.ts`
- Modify: `packages/api-server/src/services/engine-reconciler.ts:112-117` (remove function, import instead)

- [ ] **Step 1: Write the failing test**

File: `packages/api-server/src/services/parse-duration.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseDurationMs } from "./parse-duration.ts";

describe("parseDurationMs", () => {
  it("parses seconds", () => expect(parseDurationMs("5s")).toBe(5_000));
  it("parses minutes", () => expect(parseDurationMs("5m")).toBe(300_000));
  it("parses hours", () => expect(parseDurationMs("2h")).toBe(7_200_000));
  it("parses days", () => expect(parseDurationMs("30d")).toBe(2_592_000_000));
  it("parses ms", () => expect(parseDurationMs("500ms")).toBe(500));
  it("tolerates whitespace", () => expect(parseDurationMs("  30d  ")).toBe(2_592_000_000));
  it("returns 0 for empty string", () => expect(parseDurationMs("")).toBe(0));
  it("returns 0 for invalid input", () => expect(parseDurationMs("garbage")).toBe(0));
  it("returns 0 for negative numbers", () => expect(parseDurationMs("-5m")).toBe(0));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api-server && npx vitest run src/services/parse-duration.test.ts`
Expected: FAIL with "Cannot find module './parse-duration.ts'"

- [ ] **Step 3: Write minimal implementation**

File: `packages/api-server/src/services/parse-duration.ts`

```ts
const UNIT_MS = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
type Unit = keyof typeof UNIT_MS;

export function parseDurationMs(input: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)$/.exec(input.trim());
  if (!m) return 0;
  return Number(m[1]) * UNIT_MS[m[2] as Unit];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api-server && npx vitest run src/services/parse-duration.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Replace inline parser in engine-reconciler**

In `packages/api-server/src/services/engine-reconciler.ts`:
- Add import near the top: `import { parseDurationMs } from "./parse-duration.ts";`
- At line 75, change `parseDurationMsLite(cfg.timeout.duration)` → `parseDurationMs(cfg.timeout.duration)`.
- Delete the `parseDurationMsLite` function at lines 112-117.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add packages/api-server/src/services/parse-duration.ts \
        packages/api-server/src/services/parse-duration.test.ts \
        packages/api-server/src/services/engine-reconciler.ts
git commit -m "refactor: extract parseDurationMs into shared module"
```

---

## Task 2: Add `resolved_by` column to `jm_human_task_resolutions`

Distinguishes natural per-node timeouts (`node_timeout`) from sweeper-fired ones (`max_age_sweep`). Nullable so existing rows are untouched.

**Files:**
- Create: `packages/migrations/src/sql/029_resolved_by.sql`

- [ ] **Step 1: Write migration**

File: `packages/migrations/src/sql/029_resolved_by.sql`

```sql
-- 029: add resolved_by audit column to jm_human_task_resolutions.
-- Distinguishes how a paused webhook-wait/human-task was resolved beyond
-- the high-level `source` column (e.g. node-level timeout vs. operator-level
-- max-age sweep).

ALTER TABLE jm_human_task_resolutions
  ADD COLUMN IF NOT EXISTS resolved_by TEXT;

CREATE INDEX IF NOT EXISTS jm_human_task_resolutions_resolved_by_idx
  ON jm_human_task_resolutions (resolved_by)
  WHERE resolved_by IS NOT NULL;
```

- [ ] **Step 2: Run migration against the dev DB**

Run: `npm run migrate`
Expected: migration `029_resolved_by` reported as applied.

- [ ] **Step 3: Verify the column exists**

Run: `psql $DATABASE_URL -c "\d jm_human_task_resolutions" | grep resolved_by`
Expected: one line showing `resolved_by | text |`.

- [ ] **Step 4: Commit**

```bash
git add packages/migrations/src/sql/029_resolved_by.sql
git commit -m "feat(migrations): add resolved_by column to human task resolutions"
```

---

## Task 3: Persist `resolved_by` via `resolveHumanTask`

Thread the new column through the resolution code path. Defaults to null when callers don't pass it (so existing call sites keep working unchanged at runtime — they only need a string update at the per-node timeout site).

**Files:**
- Modify: `packages/api-server/src/services/resolve-human-task.ts` (add `resolvedBy?: string` to input)
- Modify: `packages/orchestrator/src/stores/human-task-resolution-store.ts` (add `resolvedBy` to args type; pass through to impls)
- Modify: `packages/orchestrator/src/stores/postgres/postgres-human-task-resolution-store.ts` (write the column)
- Modify: `packages/orchestrator/src/stores/memory/memory-human-task-resolution-store.ts` (store on the in-memory row)
- Modify: `packages/api-server/src/services/engine-reconciler.ts:78-91` (pass `resolvedBy: "node_timeout"`)

- [ ] **Step 1: Add the optional input field on `resolveHumanTask`**

In `packages/api-server/src/services/resolve-human-task.ts`, in `ResolveHumanTaskInput`:

```ts
export interface ResolveHumanTaskInput {
  workflowInstanceId: string;
  nodeId: string;
  values: Record<string, unknown>;
  payload?: Record<string, unknown>;
  actor: string | null;
  source: ResolveSource;
  webhookEventId?: string | null;
  /** Optional fine-grained reason for audit. e.g. "node_timeout" | "max_age_sweep". */
  resolvedBy?: string | null;
}
```

In the same file, in the call to `c.humanTaskResolutions.create({ ... })`, add `resolvedBy: input.resolvedBy ?? null`:

```ts
await c.humanTaskResolutions.create({
  runId: input.workflowInstanceId,
  nodeId: input.nodeId,
  outcome: pickPrimary(filled),
  comment: typeof filled.comment === "string" ? filled.comment : null,
  actor: input.actor,
  source: input.source,
  webhookEventId: input.webhookEventId ?? null,
  resolvedBy: input.resolvedBy ?? null,
});
```

- [ ] **Step 2: Extend store interface and types**

Open `packages/orchestrator/src/stores/human-task-resolution-store.ts` (or the file that defines `CreateHumanTaskResolutionArgs` — find with `grep -rn "CreateHumanTaskResolutionArgs" packages/`). Add `resolvedBy?: string | null;` to the args type.

- [ ] **Step 3: Update postgres impl**

In the postgres resolution store's `create` method, add the column to the INSERT:

```sql
INSERT INTO jm_human_task_resolutions
  (run_id, node_id, outcome, comment, actor, source, webhook_event_id, resolved_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *
```

Bind `args.resolvedBy ?? null` as `$8`.

- [ ] **Step 4: Update memory impl**

Store `resolvedBy` on the in-memory row alongside the other fields.

- [ ] **Step 5: Update per-node timeout site**

In `packages/api-server/src/services/engine-reconciler.ts:78-91`, change the `resolveHumanTask` call inside the timer to include `resolvedBy: "node_timeout"`:

```ts
c.humanTaskTimeouts.schedule(workflowInstanceId, nodeId, ms, async () => {
  const { resolveHumanTask } = await import("./resolve-human-task.ts");
  try {
    await resolveHumanTask(c, {
      workflowInstanceId, nodeId,
      values: defaults,
      payload: {},
      actor: null,
      source: "timeout",
      resolvedBy: "node_timeout",
    });
  } catch {
    // Already resolved by webhook/manual or workflow instance cancelled — not an error.
  }
});
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add packages/api-server/src/services/resolve-human-task.ts \
        packages/api-server/src/services/engine-reconciler.ts \
        packages/orchestrator/src/stores
git commit -m "feat: thread resolved_by audit field through human-task resolution"
```

---

## Task 4: Add `listOverAgePausedNodeExecutions` store method

The sweeper needs to find paused webhook-waits older than the cap. Add this as a store method so memory + postgres both implement it identically.

**Files:**
- Modify: `packages/orchestrator/src/interfaces/workflow-instance-store.interface.ts` (add method to `INodeExecutionStore`)
- Modify: `packages/orchestrator/src/stores/postgres/postgres-workflow-instance-store.ts` (postgres impl)
- Modify: `packages/orchestrator/src/stores/memory/memory-workflow-instance-store.ts` (memory impl)
- Create: `packages/orchestrator/src/stores/memory/memory-workflow-instance-store.test.ts` (or add to existing test file — check with `ls packages/orchestrator/src/stores/memory/`)

- [ ] **Step 1: Add the method to the interface**

In `packages/orchestrator/src/interfaces/workflow-instance-store.interface.ts`, on the node-execution interface (find the one that already declares `latestWaitingForInstance`), add:

```ts
/**
 * Find paused webhook-wait node executions older than `maxAgeMs`. Used by
 * the max-age sweeper. Returns ≤ `limit` rows ordered by started_at ASC
 * (oldest first) so consecutive ticks make forward progress on a backlog.
 *
 * Note: filters by `status = 'waiting'` and joins `jm_runs` for
 * `status = 'paused'`; the caller must still verify node.type === "webhook-wait"
 * against the instance's definition snapshot, since node_executions does not
 * record node type.
 */
listOverAgePausedNodeExecutions(maxAgeMs: number, limit: number): Promise<NodeExecution[]>;
```

- [ ] **Step 2: Write the failing memory-store test**

Add to (or create) `packages/orchestrator/src/stores/memory/memory-workflow-instance-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryWorkflowInstanceStore } from "./memory-workflow-instance-store.ts";

describe("listOverAgePausedNodeExecutions", () => {
  let store: MemoryWorkflowInstanceStore;

  beforeEach(() => {
    store = new MemoryWorkflowInstanceStore();
  });

  it("returns only waiting executions on paused instances older than maxAgeMs", async () => {
    const now = Date.now();
    vi.setSystemTime(now);

    // Seed: one paused instance with a waiting node started 2h ago.
    await store.upsert({
      id: "inst-old", flowVersionId: "v1", status: "paused",
      triggerSource: "manual", inputs: {}, definitionSnapshot: { nodes: [], edges: [] },
      createdAt: new Date(now - 7200_000), webhookEventId: null,
    } as any);
    await store.startNodeExecution({
      id: "exec-old", workflowInstanceId: "inst-old", nodeId: "n1",
      attempt: 1, startedAt: new Date(now - 7200_000), input: {}, conductorTaskId: "t-1",
    } as any);

    // Seed: a fresher paused instance with a waiting node started 10m ago.
    await store.upsert({
      id: "inst-new", flowVersionId: "v1", status: "paused",
      triggerSource: "manual", inputs: {}, definitionSnapshot: { nodes: [], edges: [] },
      createdAt: new Date(now - 600_000), webhookEventId: null,
    } as any);
    await store.startNodeExecution({
      id: "exec-new", workflowInstanceId: "inst-new", nodeId: "n1",
      attempt: 1, startedAt: new Date(now - 600_000), input: {}, conductorTaskId: "t-2",
    } as any);

    // Seed: a paused instance with a *completed* node (must be excluded).
    await store.upsert({
      id: "inst-done", flowVersionId: "v1", status: "paused",
      triggerSource: "manual", inputs: {}, definitionSnapshot: { nodes: [], edges: [] },
      createdAt: new Date(now - 7200_000), webhookEventId: null,
    } as any);
    await store.startNodeExecution({
      id: "exec-done", workflowInstanceId: "inst-done", nodeId: "n1",
      attempt: 1, startedAt: new Date(now - 7200_000), input: {}, conductorTaskId: "t-3",
    } as any);
    await store.markCompleted("exec-done", {});

    // Query with maxAge = 1h.
    const result = await store.listOverAgePausedNodeExecutions(3_600_000, 100);

    expect(result.map(r => r.id)).toEqual(["exec-old"]);
  });

  it("honours the limit", async () => {
    const now = Date.now();
    vi.setSystemTime(now);
    for (let i = 0; i < 5; i++) {
      await store.upsert({
        id: `inst-${i}`, flowVersionId: "v1", status: "paused",
        triggerSource: "manual", inputs: {}, definitionSnapshot: { nodes: [], edges: [] },
        createdAt: new Date(now - 7200_000), webhookEventId: null,
      } as any);
      await store.startNodeExecution({
        id: `exec-${i}`, workflowInstanceId: `inst-${i}`, nodeId: "n1",
        attempt: 1, startedAt: new Date(now - 7200_000 - i * 1000),
        input: {}, conductorTaskId: `t-${i}`,
      } as any);
    }
    const result = await store.listOverAgePausedNodeExecutions(3_600_000, 2);
    expect(result).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/orchestrator && npx vitest run src/stores/memory/memory-workflow-instance-store.test.ts`
Expected: FAIL with `listOverAgePausedNodeExecutions is not a function`.

- [ ] **Step 4: Implement on the memory store**

In `packages/orchestrator/src/stores/memory/memory-workflow-instance-store.ts`, add (alongside `latestWaitingForInstance`):

```ts
async listOverAgePausedNodeExecutions(maxAgeMs: number, limit: number): Promise<NodeExecution[]> {
  const cutoff = Date.now() - maxAgeMs;
  const pausedInstanceIds = new Set(
    [...this.instances.values()].filter(i => i.status === "paused").map(i => i.id)
  );
  return [...this.executions.values()]
    .filter(e =>
      e.status === "waiting" &&
      pausedInstanceIds.has(e.workflowInstanceId) &&
      e.startedAt != null &&
      e.startedAt.getTime() < cutoff
    )
    .sort((a, b) => (a.startedAt!.getTime() - b.startedAt!.getTime()))
    .slice(0, limit);
}
```

(If the memory store uses different field names — e.g. a different map name than `this.instances` or `this.executions` — adapt to match. Open the file first and copy the pattern from `latestWaitingForInstance`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/orchestrator && npx vitest run src/stores/memory/memory-workflow-instance-store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Implement on the postgres store**

In `packages/orchestrator/src/stores/postgres/postgres-workflow-instance-store.ts`, alongside `latestWaitingForInstance`:

```ts
async listOverAgePausedNodeExecutions(maxAgeMs: number, limit: number): Promise<NodeExecution[]> {
  const { rows } = await this.pool.query(
    `SELECT ne.*
     FROM jm_node_executions ne
     JOIN jm_workflow_instances wi ON wi.id = ne.workflow_instance_id
     WHERE ne.status = 'waiting'
       AND wi.status = 'paused'
       AND ne.started_at IS NOT NULL
       AND ne.started_at < now() - make_interval(secs => $1::numeric / 1000)
     ORDER BY ne.started_at ASC
     LIMIT $2`,
    [maxAgeMs, limit],
  );
  return rows.map(rowToExec);
}
```

(Verify that the actual workflow-instance table name is `jm_workflow_instances`. Confirm via `grep "CREATE TABLE.*workflow_instances" packages/migrations/src/sql/`. If the project still uses `jm_runs`, substitute that name and `wi.id = ne.workflow_instance_id` → `r.id = ne.run_id`, and look in `postgres-workflow-instance-store.ts` for the canonical name already used in `findPausedInstancesByIssueRef`.)

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add packages/orchestrator/src/interfaces/workflow-instance-store.interface.ts \
        packages/orchestrator/src/stores
git commit -m "feat(orchestrator): add listOverAgePausedNodeExecutions store method"
```

---

## Task 5: Implement `WebhookWaitSweeper` class

Pure logic, store + fire-handler injected. No env reading and no `setInterval` here — those live in composition/server.

**Files:**
- Create: `packages/api-server/src/services/webhook-wait-sweeper.ts`
- Create: `packages/api-server/src/services/webhook-wait-sweeper.test.ts`

- [ ] **Step 1: Write the failing test**

File: `packages/api-server/src/services/webhook-wait-sweeper.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { WebhookWaitSweeper } from "./webhook-wait-sweeper.ts";

function makeStore(execs: any[]) {
  return {
    listOverAgePausedNodeExecutions: vi.fn(async (_ms: number, limit: number) =>
      execs.slice(0, limit)),
  } as any;
}

function makeInstanceStore(snapshot: Record<string, string>) {
  // snapshot maps workflowInstanceId -> nodeType for the single node 'n1'
  return {
    getById: vi.fn(async (id: string) => snapshot[id] != null ? ({
      id,
      definitionSnapshot: { nodes: [{ id: "n1", type: snapshot[id], config: { timeout: { defaults: { reason: "default" } } } }], edges: [] },
    }) : null),
  } as any;
}

describe("WebhookWaitSweeper", () => {
  it("does nothing when maxAgeMs is 0", async () => {
    const store = makeStore([]);
    const instanceStore = makeInstanceStore({});
    const fire = vi.fn();
    const sweeper = new WebhookWaitSweeper({
      maxAgeMs: 0, intervalMs: 60_000, batchSize: 500,
      nodeExecutions: store, workflowInstances: instanceStore, fire,
    });
    await sweeper.tick();
    expect(store.listOverAgePausedNodeExecutions).not.toHaveBeenCalled();
    expect(fire).not.toHaveBeenCalled();
  });

  it("fires only for webhook-wait nodes (skips human-task)", async () => {
    const execs = [
      { id: "e1", workflowInstanceId: "inst-1", nodeId: "n1" },
      { id: "e2", workflowInstanceId: "inst-2", nodeId: "n1" },
    ];
    const instanceStore = makeInstanceStore({
      "inst-1": "webhook-wait",
      "inst-2": "human-task",
    });
    const fire = vi.fn(async () => {});
    const sweeper = new WebhookWaitSweeper({
      maxAgeMs: 60_000, intervalMs: 60_000, batchSize: 500,
      nodeExecutions: makeStore(execs), workflowInstances: instanceStore, fire,
    });
    await sweeper.tick();
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith({
      workflowInstanceId: "inst-1",
      nodeId: "n1",
      defaults: { reason: "default" },
    });
  });

  it("does not throw when fire-handler throws (one row's failure does not poison the batch)", async () => {
    const execs = [
      { id: "e1", workflowInstanceId: "inst-1", nodeId: "n1" },
      { id: "e2", workflowInstanceId: "inst-2", nodeId: "n1" },
    ];
    const instanceStore = makeInstanceStore({
      "inst-1": "webhook-wait",
      "inst-2": "webhook-wait",
    });
    const fire = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const sweeper = new WebhookWaitSweeper({
      maxAgeMs: 60_000, intervalMs: 60_000, batchSize: 500,
      nodeExecutions: makeStore(execs), workflowInstances: instanceStore, fire,
    });
    await expect(sweeper.tick()).resolves.toBeUndefined();
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it("uses batchSize as the store limit", async () => {
    const store = makeStore([]);
    const sweeper = new WebhookWaitSweeper({
      maxAgeMs: 60_000, intervalMs: 60_000, batchSize: 42,
      nodeExecutions: store, workflowInstances: makeInstanceStore({}), fire: vi.fn(),
    });
    await sweeper.tick();
    expect(store.listOverAgePausedNodeExecutions).toHaveBeenCalledWith(60_000, 42);
  });

  it("start()/stop() schedule and clear the interval", () => {
    vi.useFakeTimers();
    const tickSpy = vi.spyOn(WebhookWaitSweeper.prototype as any, "tick").mockResolvedValue(undefined);
    const sweeper = new WebhookWaitSweeper({
      maxAgeMs: 60_000, intervalMs: 1_000, batchSize: 500,
      nodeExecutions: makeStore([]), workflowInstances: makeInstanceStore({}), fire: vi.fn(),
    });
    sweeper.start();
    vi.advanceTimersByTime(3_500);
    expect(tickSpy).toHaveBeenCalledTimes(3);
    sweeper.stop();
    vi.advanceTimersByTime(5_000);
    expect(tickSpy).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api-server && npx vitest run src/services/webhook-wait-sweeper.test.ts`
Expected: FAIL with `Cannot find module './webhook-wait-sweeper.ts'`.

- [ ] **Step 3: Write the implementation**

File: `packages/api-server/src/services/webhook-wait-sweeper.ts`

```ts
import type { NodeExecution, WorkflowInstance } from "@journeyman/core";

interface NodeExecutionStoreLike {
  listOverAgePausedNodeExecutions(maxAgeMs: number, limit: number): Promise<NodeExecution[]>;
}

interface WorkflowInstanceStoreLike {
  getById(id: string): Promise<WorkflowInstance | null>;
}

export interface WebhookWaitSweeperOptions {
  /** Max age in ms for a paused webhook-wait. 0 = disabled. */
  maxAgeMs: number;
  /** Tick interval in ms. */
  intervalMs: number;
  /** Max executions resolved per tick. */
  batchSize: number;
  nodeExecutions: NodeExecutionStoreLike;
  workflowInstances: WorkflowInstanceStoreLike;
  /** Fire-handler called once per over-age webhook-wait. Should be idempotent w.r.t. already-resolved nodes. */
  fire: (args: { workflowInstanceId: string; nodeId: string; defaults: Record<string, unknown> }) => Promise<void>;
}

export class WebhookWaitSweeper {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: WebhookWaitSweeperOptions) {}

  start(): void {
    if (this.opts.maxAgeMs <= 0) {
      console.log("[webhook-wait-sweeper] disabled by config");
      return;
    }
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(err => console.error("[webhook-wait-sweeper] tick failed:", err));
    }, this.opts.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.opts.maxAgeMs <= 0) return;

    const rows = await this.opts.nodeExecutions.listOverAgePausedNodeExecutions(
      this.opts.maxAgeMs,
      this.opts.batchSize,
    );

    for (const exec of rows) {
      try {
        const instance = await this.opts.workflowInstances.getById(exec.workflowInstanceId);
        if (!instance) continue;

        const node = instance.definitionSnapshot.nodes.find(n => n.id === exec.nodeId);
        if (!node || node.type !== "webhook-wait") continue;

        const cfg = (node.config ?? {}) as { timeout?: { defaults?: Record<string, unknown> } };
        const defaults = cfg.timeout?.defaults ?? {};

        await this.opts.fire({
          workflowInstanceId: exec.workflowInstanceId,
          nodeId: exec.nodeId,
          defaults,
        });
      } catch (err) {
        console.error(
          `[webhook-wait-sweeper] failed for ${exec.workflowInstanceId}/${exec.nodeId}:`,
          err,
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api-server && npx vitest run src/services/webhook-wait-sweeper.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api-server/src/services/webhook-wait-sweeper.ts \
        packages/api-server/src/services/webhook-wait-sweeper.test.ts
git commit -m "feat: webhook-wait max-age sweeper class"
```

---

## Task 6: Wire sweeper into Composition

Read env vars; construct sweeper with the existing `resolveHumanTask` as the fire-handler.

**Files:**
- Modify: `packages/api-server/src/composition.ts`

- [ ] **Step 1: Add sweeper to the Composition type**

Open `packages/api-server/src/composition.ts`. The file currently builds and returns a single object literal at the end. We need to:
- declare a `Composition` variable up front
- build it as an object literal as today
- attach `webhookWaitSweeper` afterwards (it needs the composition reference in its fire-handler closure)
- return

Add to the `Composition` type definition (near `humanTaskTimeouts: HumanTaskTimeoutService;`):

```ts
webhookWaitSweeper: WebhookWaitSweeper;
```

- [ ] **Step 2: Add imports at the top of the file**

```ts
import { WebhookWaitSweeper } from "./services/webhook-wait-sweeper.ts";
import { parseDurationMs } from "./services/parse-duration.ts";
import { resolveHumanTask } from "./services/resolve-human-task.ts";
```

- [ ] **Step 3: Build composition then attach sweeper**

Replace the current `return { ... };` block (around line 152) with this pattern:

```ts
const composition: Composition = {
  workflowGrants, workflowInstanceGrants, workflows, workflowVersions, workflowInstances,
  nodeExecutions, events, webhookEvents, webhooks, workflowTriggers,
  humanTaskResolutions, humanTaskTimeouts, conductorClient,
  orchestrator, registry, workspace, auth, conditions,
  pool,
  // webhookWaitSweeper assigned below — needs the composition reference for its fire-handler.
  webhookWaitSweeper: null as unknown as WebhookWaitSweeper,
  shutdown: async () => { if (pool) await pool.end(); },
};

const maxAgeStr = (process.env.JOURNEYMAN_WEBHOOK_WAIT_MAX_AGE ?? "30d").trim();
const intervalStr = (process.env.JOURNEYMAN_WEBHOOK_WAIT_SWEEP_INTERVAL ?? "5m").trim();

const sweeperDisabled = maxAgeStr === "" || maxAgeStr.toLowerCase() === "off";
const maxAgeMs = sweeperDisabled ? 0 : parseDurationMs(maxAgeStr);
if (!sweeperDisabled && maxAgeMs === 0) {
  throw new Error(
    `Invalid JOURNEYMAN_WEBHOOK_WAIT_MAX_AGE: "${maxAgeStr}". Use a duration like "30d", "12h", "90m", or "off".`,
  );
}
const intervalMs = parseDurationMs(intervalStr) || 5 * 60_000;

composition.webhookWaitSweeper = new WebhookWaitSweeper({
  maxAgeMs,
  intervalMs,
  batchSize: 500,
  nodeExecutions,
  workflowInstances,
  fire: async ({ workflowInstanceId, nodeId, defaults }) => {
    try {
      await resolveHumanTask(composition, {
        workflowInstanceId,
        nodeId,
        values: defaults,
        payload: {},
        actor: null,
        source: "timeout",
        resolvedBy: "max_age_sweep",
      });
    } catch {
      // Already resolved by webhook/manual or instance cancelled — not an error.
    }
  },
});

return composition;
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api-server/src/composition.ts
git commit -m "feat: wire webhook-wait sweeper into api-server composition"
```

---

## Task 7: Start/stop sweeper from server lifecycle

**Files:**
- Modify: `packages/api-server/src/server.ts`

- [ ] **Step 1: Locate the place after composition is built and the server is ready**

Open `packages/api-server/src/server.ts`. Find where `composition` is built and where `app.listen(...)` is called. The sweeper should `start()` after `composition` is available; `stop()` should run on shutdown.

- [ ] **Step 2: Add start + shutdown hooks**

After `composition` is built:

```ts
composition.webhookWaitSweeper.start();
```

Near where other shutdown logic lives (or `app.addHook("onClose", ...)`), add:

```ts
app.addHook("onClose", async () => {
  composition.webhookWaitSweeper.stop();
});
```

If there is no existing `onClose` hook for the human-task timeouts, follow the same pattern Fastify uses elsewhere in this file.

- [ ] **Step 3: Manual smoke test**

Run the server locally and check the startup log shows either the sweeper running or `disabled by config`:

```bash
npm run start:api-server
```

In another terminal, set `JOURNEYMAN_WEBHOOK_WAIT_MAX_AGE=off` and restart. Confirm the log line `[webhook-wait-sweeper] disabled by config` appears.

- [ ] **Step 4: Commit**

```bash
git add packages/api-server/src/server.ts
git commit -m "feat: start/stop webhook-wait sweeper from server lifecycle"
```

---

## Task 8: End-to-end integration test

Verify the full path: a paused webhook-wait older than the configured age is resolved via the timeout branch, with `resolved_by = "max_age_sweep"` recorded.

**Files:**
- Create: `packages/api-server/src/services/webhook-wait-sweeper.integration.test.ts`

- [ ] **Step 1: Write the test**

File: `packages/api-server/src/services/webhook-wait-sweeper.integration.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { WebhookWaitSweeper } from "./webhook-wait-sweeper.ts";
import { resolveHumanTask } from "./resolve-human-task.ts";

// This test uses the in-memory composition. It exercises:
//   1. listOverAgePausedNodeExecutions returns the stale paused webhook-wait
//   2. sweeper.tick() invokes resolveHumanTask with source="timeout", resolvedBy="max_age_sweep"
//   3. the node_execution moves from waiting -> completed
//   4. a resolution row is recorded with resolved_by = "max_age_sweep"

import { buildMemoryComposition } from "../test-helpers/memory-composition.ts"; // helper that the project already uses for in-memory tests — confirm name with `grep -rn 'buildMemoryComposition\|buildTestComposition' packages/api-server/src`

describe("webhook-wait sweeper (integration, memory store)", () => {
  it("resolves an over-age paused webhook-wait via the timeout branch", async () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const c = buildMemoryComposition();

    // Seed a paused workflow instance with a waiting webhook-wait node.
    const instanceId = "inst-1";
    await c.workflowInstances.upsert({
      id: instanceId,
      flowVersionId: "v1",
      status: "paused",
      triggerSource: "manual",
      inputs: { issueRef: "gh:org/repo#1" },
      definitionSnapshot: {
        nodes: [{
          id: "n-wait",
          type: "webhook-wait",
          config: { outputs: [], timeout: { duration: "999d", defaults: { reason: "swept" } } },
        }],
        edges: [],
      },
      createdAt: new Date(now - 7200_000),
      webhookEventId: null,
    } as any);

    await c.nodeExecutions.startNodeExecution({
      id: "exec-1",
      workflowInstanceId: instanceId,
      nodeId: "n-wait",
      attempt: 1,
      startedAt: new Date(now - 7200_000), // 2h ago
      input: {},
      conductorTaskId: "ct-1",
    } as any);

    const sweeper = new WebhookWaitSweeper({
      maxAgeMs: 3_600_000, // 1h
      intervalMs: 60_000,
      batchSize: 500,
      nodeExecutions: c.nodeExecutions,
      workflowInstances: c.workflowInstances,
      fire: async (args) => {
        await resolveHumanTask(c, {
          workflowInstanceId: args.workflowInstanceId,
          nodeId: args.nodeId,
          values: args.defaults,
          payload: {},
          actor: null,
          source: "timeout",
          resolvedBy: "max_age_sweep",
        });
      },
    });

    await sweeper.tick();

    const exec = await c.nodeExecutions.latestForNode(instanceId, "n-wait");
    expect(exec?.status).toBe("completed");
    expect(exec?.output?.source).toBe("timeout");
    expect(exec?.output?.reason).toBe("swept"); // came from timeout.defaults

    const resolutions = await c.humanTaskResolutions.listByRun(instanceId);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].source).toBe("timeout");
    expect(resolutions[0].resolvedBy).toBe("max_age_sweep");
  });
});
```

If `buildMemoryComposition` and `humanTaskResolutions.listByRun` don't exist verbatim, find the closest equivalents the project already uses (e.g. test helper that builds a memory `Composition`, and the resolution store's `list` / `listByRun` / `getForRun` method). The behavior asserted above is what matters: status transitions, output payload, resolution row.

- [ ] **Step 2: Run test**

Run: `cd packages/api-server && npx vitest run src/services/webhook-wait-sweeper.integration.test.ts`
Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add packages/api-server/src/services/webhook-wait-sweeper.integration.test.ts
git commit -m "test: integration test for webhook-wait sweeper"
```

---

## Task 9: Run full project checks

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 2: Import-boundary check**

Run: `npm run check:boundaries`
Expected: zero violations.

- [ ] **Step 3: Tests**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 4: Final commit if anything was tweaked**

```bash
git status
# If anything is dirty:
git add -A
git commit -m "chore: post-implementation cleanup for webhook-wait sweeper"
```

---

## Acceptance Criteria (from the spec)

- [x] `JOURNEYMAN_WEBHOOK_WAIT_MAX_AGE` / `JOURNEYMAN_WEBHOOK_WAIT_SWEEP_INTERVAL` env vars loaded at startup (Task 6).
- [x] Setting `MAX_AGE=off` (or empty) disables the sweeper with a startup log line (Tasks 5, 6).
- [x] Malformed `MAX_AGE` throws at startup, not silently disables (Task 6).
- [x] Sweeper fires the same `resolveHumanTask({source:"timeout"})` path as the per-node timer (Tasks 5, 6).
- [x] `resolved_by` distinguishes `node_timeout` from `max_age_sweep` (Tasks 2, 3).
- [x] Sweeper picks up only paused webhook-wait nodes; ignores human-task and non-paused (Tasks 4, 5).
- [x] One row's failure does not poison the batch (Task 5).
- [x] Sweeper survives the same restart pattern any api-server service does — it's a stateless polling job (Tasks 5, 7).

## Deferred (out of scope for this plan)

- **Run-viewer surfacing of `resolved_by`.** The spec mentioned showing the value as a footnote on the node detail panel. The data is now captured (Task 3) so any future UI work has it available, but the actual panel change is a separate follow-up — keeps this plan focused on the operator-level safety net.

## Risk Mitigations Verified

- **Sweeper overload after long outage** — `batchSize: 500` per tick, ordered by `started_at ASC` (Task 4 SQL).
- **Double-fire race** — `resolveHumanTask` already throws if the node isn't `waiting`; the sweeper's per-row `try/catch` treats this as a no-op (Tasks 5, 6).
- **`resolved_by` migration safety** — column is nullable text, no default backfill, `ADD COLUMN IF NOT EXISTS` (Task 2).
