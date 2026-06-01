# Workflow Pause/Run Status Derivation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A non-terminal run is `paused` iff it has a step currently waiting, else `running` — derived from `jm_node_executions`, not from polling Conductor — and first-wins losers are cleaned up the instant a winner is chosen.

**Architecture:** Status is derived from waiting node-executions via a `recomputeWaitStatus` helper called at every wait transition. `resolveHumanTask` cancels first-wins siblings event-driven and clears their waiting rows. The webhook matcher keys off waiting rows (not `status='paused'`). `syncStatus` stops managing the paused/running distinction (engine `PAUSED` = manual pause; `RUNNING` defers to derivation). A slow syncer-driven reconcile backstops unattended runs.

**Tech Stack:** TypeScript; `@journeyman/core` types; `@journeyman/orchestrator` (Conductor stores, syncStatus, first-wins controller); `@journeyman/api-server` (reconciler, resolve-human-task, matcher); vitest.

**Constraints (per request):** No git commits in any step. The final task runs `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-06-01-workflow-pause-status-derivation-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/types/workflow-instance.types.ts` | Add `isTerminalStatus` helper + `TERMINAL_STATUSES` |
| `packages/core/src/index.ts` | Export the helper |
| `packages/core/src/interfaces/workflow-instance-store.interface.ts` | Add `markSkipped` to `INodeExecutionStore` |
| `packages/orchestrator/src/stores/postgres/postgres-workflow-instance-store.ts` | `markSkipped`; decouple matcher + over-age queries from `paused` |
| `packages/orchestrator/src/stores/memory/memory-workflow-instance-store.ts` | Same, in-memory |
| `packages/orchestrator/src/sync/first-wins-controller.ts` | Accept optional preloaded tasks (single-fetch) |
| `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts` | `syncStatus`: drop sticky guard; defer paused/running to derivation |
| `packages/orchestrator/src/sync/workflow-instance-syncer.ts` | Inject `reconcilePaused` hook; suppress duplicate `started` |
| `packages/api-server/src/services/recompute-wait-status.ts` | **New** `recomputeWaitStatus` |
| `packages/api-server/src/services/resolve-human-task.ts` | Event-driven loser cancel + clear rows + recompute |
| `packages/api-server/src/services/engine-reconciler.ts` | recompute after markWaiting/cancel; single task fetch |
| `packages/api-server/src/services/match-human-tasks.ts` | Replace `!=='paused'` gate with terminal gate |
| `packages/api-server/src/composition.ts` + `cli-start.ts` | Wire `reconcilePaused` into the syncer |

---

## Task 1: `isTerminalStatus` helper in core

**Files:**
- Modify: `packages/core/src/types/workflow-instance.types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/types/workflow-instance-status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/types/workflow-instance-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isTerminalStatus } from "./workflow-instance.types.ts";

describe("isTerminalStatus", () => {
  it("treats completed/failed/cancelled as terminal", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
  });
  it("treats pending/running/paused as non-terminal", () => {
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("running")).toBe(false);
    expect(isTerminalStatus("paused")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/types/workflow-instance-status.test.ts`
Expected: FAIL — `isTerminalStatus` is not exported.

- [ ] **Step 3: Add the helper**

In `packages/core/src/types/workflow-instance.types.ts`, after the `WorkflowInstanceStatus` type (after line 10), add:

```ts
export const TERMINAL_STATUSES: readonly WorkflowInstanceStatus[] = ["completed", "failed", "cancelled"];

/** True for completed/failed/cancelled — states the engine owns and derivation must not touch. */
export function isTerminalStatus(status: WorkflowInstanceStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/core/src/index.ts`, find the `export type { ... } from "./types/workflow-instance.types.ts";` block (the one exporting `WorkflowInstance`, `WorkflowInstanceStatus`, …) and add a value export right after it:

```ts
export { isTerminalStatus, TERMINAL_STATUSES } from "./types/workflow-instance.types.ts";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/core/src/types/workflow-instance-status.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify (no commit — per request).**

---

## Task 2: `markSkipped` store method

**Files:**
- Modify: `packages/core/src/interfaces/workflow-instance-store.interface.ts`
- Modify: `packages/orchestrator/src/stores/postgres/postgres-workflow-instance-store.ts`
- Modify: `packages/orchestrator/src/stores/memory/memory-workflow-instance-store.ts`
- Test: `packages/orchestrator/src/stores/memory/mark-skipped.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/stores/memory/mark-skipped.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MemoryWorkflowInstanceStore } from "./memory-workflow-instance-store.ts";

describe("markSkipped (memory)", () => {
  it("flips a waiting row to skipped and clears it from waiting lookups", async () => {
    const store = new MemoryWorkflowInstanceStore();
    const exec = await store.markWaiting("wi-1", "node-a", "ctask-1", { eventPath: "$.x", value: "1" });
    expect(exec.status).toBe("waiting");

    const skipped = await store.markSkipped(exec.id);
    expect(skipped.status).toBe("skipped");
    expect(skipped.completedAt).not.toBeNull();

    expect(await store.latestWaitingForInstance("wi-1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/orchestrator/src/stores/memory/mark-skipped.test.ts`
Expected: FAIL — `markSkipped` does not exist.

- [ ] **Step 3: Add to the interface**

In `packages/core/src/interfaces/workflow-instance-store.interface.ts`, inside `INodeExecutionStore`, after `markCompleted(...)`, add:

```ts
  /** Flip a node execution to `skipped` (e.g. a cancelled first-wins loser). Clears it from waiting lookups. */
  markSkipped(executionId: string): Promise<NodeExecution>;
```

- [ ] **Step 4: Implement in the memory store**

In `packages/orchestrator/src/stores/memory/memory-workflow-instance-store.ts`, right after the `markCompleted` method (after line 181), add:

```ts
  async markSkipped(executionId: string): Promise<NodeExecution> {
    const row = this.rows.get(executionId);
    if (!row) throw new Error(`node_execution ${executionId} not found`);
    const updated: NodeExecution = { ...row, status: "skipped", completedAt: new Date() };
    this.rows.set(executionId, updated);
    return updated;
  }
```

- [ ] **Step 5: Implement in the postgres store**

In `packages/orchestrator/src/stores/postgres/postgres-workflow-instance-store.ts`, right after the `markCompleted` method, add:

```ts
  async markSkipped(executionId: string): Promise<NodeExecution> {
    const { rows } = await this.pool.query(
      `UPDATE jm_node_executions
       SET status = 'skipped', completed_at = now()
       WHERE id = $1 RETURNING *`,
      [executionId],
    );
    if (rows.length === 0) throw new Error(`node_execution ${executionId} not found`);
    return rowToExec(rows[0]);
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/orchestrator/src/stores/memory/mark-skipped.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify (no commit — per request).**

---

## Task 3: Decouple matcher queries from `status='paused'`

**Files:**
- Modify: `packages/orchestrator/src/stores/postgres/postgres-workflow-instance-store.ts`
- Modify: `packages/orchestrator/src/stores/memory/memory-workflow-instance-store.ts`
- Test: `packages/orchestrator/src/stores/memory/matcher-decouple.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/stores/memory/matcher-decouple.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MemoryWorkflowInstanceStore } from "./memory-workflow-instance-store.ts";

// The memory NodeExecution store reads instance statuses via its linked instance store.
// MemoryWorkflowInstanceStore wires both together; we set an instance to "running"
// (not "paused") with a waiting+correlated node and expect it to still be found.
describe("findAllWaitingWithCorrelation — decoupled from paused", () => {
  it("matches a waiting+correlated node on a RUNNING (non-terminal) instance", async () => {
    const store = new MemoryWorkflowInstanceStore();
    const inst = await store.create({
      workflowId: "w", workflowVersionId: "v", workflowNameSnapshot: "n",
      workflowScopeSnapshot: "user", definitionSnapshot: { nodes: [], edges: [] } as never,
      triggerSource: "manual", startedByUserId: null, startedByOrgId: null, inputs: {},
    });
    await store.setStatus(inst.id, "running");
    await store.markWaiting(inst.id, "wh", "ctask", { eventPath: "$.n", value: "6" });

    const found = await store.findAllWaitingWithCorrelation();
    expect(found.map(f => f.workflowInstanceId)).toContain(inst.id);
  });

  it("excludes terminal instances", async () => {
    const store = new MemoryWorkflowInstanceStore();
    const inst = await store.create({
      workflowId: "w", workflowVersionId: "v", workflowNameSnapshot: "n",
      workflowScopeSnapshot: "user", definitionSnapshot: { nodes: [], edges: [] } as never,
      triggerSource: "manual", startedByUserId: null, startedByOrgId: null, inputs: {},
    });
    await store.markWaiting(inst.id, "wh", "ctask", { eventPath: "$.n", value: "6" });
    await store.setStatus(inst.id, "completed");

    const found = await store.findAllWaitingWithCorrelation();
    expect(found.map(f => f.workflowInstanceId)).not.toContain(inst.id);
  });
});
```

> Note: `MemoryWorkflowInstanceStore` is both the instance store and node-execution store (it implements both interfaces and links them). If `create`/`setStatus` are on a different exported class in this file, adjust the test to construct the same way the existing memory tests do — check the top of `memory-workflow-instance-store.ts` for the constructor wiring before writing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/orchestrator/src/stores/memory/matcher-decouple.test.ts`
Expected: FAIL — the RUNNING instance is not matched (current code filters to `paused`).

- [ ] **Step 3: Update the memory store**

In `packages/orchestrator/src/stores/memory/memory-workflow-instance-store.ts`, add an import at the top:

```ts
import { isTerminalStatus } from "@journeyman/core";
```

Replace `findAllWaitingWithCorrelation` (lines ~164-174) with:

```ts
  async findAllWaitingWithCorrelation(): Promise<NodeExecution[]> {
    if (!this.instances) return [];
    const liveInstanceIds = new Set(
      [...this.instances.allInstances()].filter(i => !isTerminalStatus(i.status)).map(i => i.id),
    );
    return [...this.rows.values()].filter(e =>
      e.status === "waiting"
      && liveInstanceIds.has(e.workflowInstanceId)
      && e.correlationValue != null,
    );
  }
```

And replace the `pausedInstanceIds` filter inside `listOverAgePausedNodeExecutions` (lines ~201-204) with the non-terminal equivalent:

```ts
    const liveInstanceIds = new Set(
      [...this.instances.allInstances()].filter(i => !isTerminalStatus(i.status)).map(i => i.id),
    );
```

and update the filter body to reference `liveInstanceIds` instead of `pausedInstanceIds`.

- [ ] **Step 4: Update the postgres store**

In `packages/orchestrator/src/stores/postgres/postgres-workflow-instance-store.ts`, replace the `findAllWaitingWithCorrelation` query's WHERE clause:

```ts
        WHERE ne.status = 'waiting'
          AND wi.status NOT IN ('completed','failed','cancelled')
          AND ne.correlation_value IS NOT NULL`,
```

And in `listOverAgePausedNodeExecutions`, replace `AND wi.status = 'paused'` with:

```ts
         AND wi.status NOT IN ('completed','failed','cancelled')
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/orchestrator/src/stores/memory/matcher-decouple.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify (no commit — per request).**

---

## Task 4: `recomputeWaitStatus` service

**Files:**
- Create: `packages/api-server/src/services/recompute-wait-status.ts`
- Test: `packages/api-server/src/services/recompute-wait-status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api-server/src/services/recompute-wait-status.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { recomputeWaitStatus } from "./recompute-wait-status.ts";

function makeC(status: string, hasWaiting: boolean) {
  const setStatus = vi.fn().mockResolvedValue(undefined);
  const c = {
    workflowInstances: {
      getById: vi.fn().mockResolvedValue(status ? { id: "wi", status } : null),
      setStatus,
    },
    nodeExecutions: {
      latestWaitingForInstance: vi.fn().mockResolvedValue(hasWaiting ? { id: "ne" } : null),
    },
  } as never;
  return { c, setStatus };
}

describe("recomputeWaitStatus", () => {
  it("sets paused when a waiting row exists", async () => {
    const { c, setStatus } = makeC("running", true);
    await recomputeWaitStatus(c, "wi");
    expect(setStatus).toHaveBeenCalledWith("wi", "paused");
  });
  it("sets running when no waiting row exists", async () => {
    const { c, setStatus } = makeC("paused", false);
    await recomputeWaitStatus(c, "wi");
    expect(setStatus).toHaveBeenCalledWith("wi", "running");
  });
  it("is a no-op when status already matches", async () => {
    const { c, setStatus } = makeC("running", false);
    await recomputeWaitStatus(c, "wi");
    expect(setStatus).not.toHaveBeenCalled();
  });
  it("never touches a terminal instance", async () => {
    const { c, setStatus } = makeC("completed", false);
    await recomputeWaitStatus(c, "wi");
    expect(setStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/api-server/src/services/recompute-wait-status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

Create `packages/api-server/src/services/recompute-wait-status.ts`:

```ts
import type { Composition } from "../composition.ts";
import { isTerminalStatus } from "@journeyman/core";

/**
 * Derive paused/running from waiting node-executions and persist it.
 *   - waiting row exists  → "paused"
 *   - none                → "running"
 *   - terminal instance   → no-op (the engine owns terminal states)
 *
 * Safety: only call this in contexts where the run is genuinely engine-RUNNING
 * (after resolving/cancelling a wait, or from the backstop which has confirmed
 * the engine is RUNNING). A *manually* paused run reports Conductor PAUSED and
 * is never a caller here, so this never un-pauses a manual pause.
 */
export async function recomputeWaitStatus(c: Composition, workflowInstanceId: string): Promise<void> {
  const instance = await c.workflowInstances.getById(workflowInstanceId);
  if (!instance || isTerminalStatus(instance.status)) return;
  const waiting = await c.nodeExecutions.latestWaitingForInstance(workflowInstanceId);
  const desired = waiting ? "paused" : "running";
  if (instance.status !== desired) {
    await c.workflowInstances.setStatus(workflowInstanceId, desired);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/api-server/src/services/recompute-wait-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify (no commit — per request).**

---

## Task 5: first-wins controller accepts preloaded tasks (single fetch)

**Files:**
- Modify: `packages/orchestrator/src/sync/first-wins-controller.ts`
- Test: `packages/orchestrator/src/sync/first-wins-controller.test.ts`

- [ ] **Step 1: Add the assertion to the existing test**

In `packages/orchestrator/src/sync/first-wins-controller.test.ts`, add a new `it(...)` inside the existing `describe` block that passes preloaded tasks and asserts `getWorkflowWithTasks` is NOT called:

```ts
  it("uses preloaded tasks and skips the extra getWorkflowWithTasks fetch", async () => {
    const tasks = [
      { taskId: "ht", taskType: "HUMAN", referenceTaskName: "human-task_vy3p35", status: "COMPLETED", inputData: {} },
      { taskId: "ww", taskType: "HUMAN", referenceTaskName: "webhook-wait_pbfs1v", status: "IN_PROGRESS", inputData: {} },
      {
        taskId: "join-id", taskType: "JOIN", referenceTaskName: "join_8a8gat", status: "IN_PROGRESS",
        inputData: { joinOn: ["webhook-wait_pbfs1v", "human-task_vy3p35"] },
        workflowTask: { type: "JOIN", joinOn: ["webhook-wait_pbfs1v", "human-task_vy3p35"],
          inputParameters: { mode: "first-wins", branchTaskRefs: [["webhook-wait_pbfs1v"], ["human-task_vy3p35"]] } },
      },
    ];
    const getWorkflowWithTasks = (() => { throw new Error("should not fetch"); });
    const completed: Array<{ taskId: string }> = [];
    const client = {
      getWorkflowWithTasks,
      completeTask: async (b: { taskId: string }) => { completed.push({ taskId: b.taskId }); },
    } as never;

    const { cancelled } = await applyFirstWinsCancellation(client, "wf", { tasks });
    expect(cancelled).toContain("webhook-wait_pbfs1v");
    expect(completed.map(c => c.taskId)).toContain("ww");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/orchestrator/src/sync/first-wins-controller.test.ts`
Expected: FAIL — the function ignores the 3rd arg and calls `getWorkflowWithTasks`, which throws.

- [ ] **Step 3: Add the optional preloaded-tasks parameter**

In `packages/orchestrator/src/sync/first-wins-controller.ts`, change the signature and the fetch:

```ts
export async function applyFirstWinsCancellation(
  conductor: ConductorClient,
  engineWorkflowId: string,
  opts?: { tasks?: Awaited<ReturnType<ConductorClient["getWorkflowWithTasks"]>>["tasks"] },
): Promise<{ cancelled: string[] }> {
  const tasks = opts?.tasks ?? (await conductor.getWorkflowWithTasks(engineWorkflowId)).tasks;
  const cancelled: string[] = [];

  const joins = (tasks ?? []).filter(t =>
    t.taskType === "JOIN" && t.status === "IN_PROGRESS",
  );
```

Then replace the remaining references to `wf.tasks` in the function body with `tasks` (the loop that finds `completedTerminals` and the `(wf.tasks ?? []).find(...)` for the cancel target both become `(tasks ?? [])`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/orchestrator/src/sync/first-wins-controller.test.ts`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Verify (no commit — per request).**

---

## Task 6: Event-driven loser cleanup in `resolveHumanTask`

**Files:**
- Modify: `packages/api-server/src/services/resolve-human-task.ts`
- Test: `packages/api-server/src/services/resolve-human-task.first-wins.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api-server/src/services/resolve-human-task.first-wins.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { resolveHumanTask } from "./resolve-human-task.ts";

function buildComposition() {
  const statusSets: Array<[string, string]> = [];
  const skipped: string[] = [];
  const events: Array<{ nodeId: string; eventType: string }> = [];
  const instance = {
    id: "wi", engineWorkflowId: "eng",
    status: "paused",
    definitionSnapshot: { nodes: [
      { id: "wh", type: "webhook-wait", config: { outputs: [] } },
      { id: "ht", type: "human-task", config: { outputs: [] } },
    ] },
  };
  // node executions: wh waiting (the winner), ht waiting (the loser)
  const execs: Record<string, { id: string; nodeId: string; status: string; conductorTaskId: string }> = {
    wh: { id: "ne-wh", nodeId: "wh", status: "waiting", conductorTaskId: "ct-wh" },
    ht: { id: "ne-ht", nodeId: "ht", status: "waiting", conductorTaskId: "ct-ht" },
  };
  const c = {
    workflowInstances: {
      getById: vi.fn().mockImplementation(async () => ({ ...instance })),
      setStatus: vi.fn().mockImplementation(async (_id: string, s: string) => { statusSets.push(["set", s]); instance.status = s; }),
    },
    nodeExecutions: {
      latestForNode: vi.fn().mockImplementation(async (_wi: string, nodeId: string) => execs[nodeId] ?? null),
      markCompleted: vi.fn().mockImplementation(async (id: string) => { const e = Object.values(execs).find(x => x.id === id)!; e.status = "completed"; return e; }),
      markSkipped: vi.fn().mockImplementation(async (id: string) => { const e = Object.values(execs).find(x => x.id === id)!; e.status = "skipped"; skipped.push(id); return e; }),
      latestWaitingForInstance: vi.fn().mockImplementation(async () => Object.values(execs).find(x => x.status === "waiting") ?? null),
    },
    humanTaskTimeouts: { cancel: vi.fn() },
    humanTaskResolutions: { create: vi.fn().mockResolvedValue(undefined) },
    events: { append: vi.fn().mockImplementation(async (e: { nodeId: string; eventType: string }) => { events.push(e); }) },
    conductorClient: {
      completeTask: vi.fn().mockResolvedValue(undefined),
      getWorkflowWithTasks: vi.fn().mockResolvedValue({ tasks: [
        { taskId: "ct-wh", taskType: "HUMAN", referenceTaskName: "wh", status: "COMPLETED", inputData: {} },
        { taskId: "ct-ht", taskType: "HUMAN", referenceTaskName: "ht", status: "IN_PROGRESS", inputData: {} },
        { taskId: "j", taskType: "JOIN", referenceTaskName: "join", status: "IN_PROGRESS",
          inputData: { joinOn: ["wh", "ht"] },
          workflowTask: { type: "JOIN", joinOn: ["wh", "ht"], inputParameters: { mode: "first-wins", branchTaskRefs: [["wh"], ["ht"]] } } },
      ] }),
    },
  } as never;
  return { c, instance, skipped, events, statusSets };
}

describe("resolveHumanTask — first-wins event-driven cleanup", () => {
  it("cancels the loser, marks its row skipped, emits node.resolved, and flips to running", async () => {
    const { c, instance, skipped, events } = buildComposition();
    await resolveHumanTask(c, { workflowInstanceId: "wi", nodeId: "wh", values: {}, actor: null, source: "webhook" });

    expect(skipped).toContain("ne-ht");                          // loser row cleared
    expect(events.some(e => e.nodeId === "ht" && e.eventType === "node.resolved")).toBe(true);
    expect(instance.status).toBe("running");                     // no waits remain → running
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/api-server/src/services/resolve-human-task.first-wins.test.ts`
Expected: FAIL — loser is never skipped; status ends `running` only via the old unconditional set (the `markSkipped`/`node.resolved` assertions fail).

- [ ] **Step 3: Update `resolveHumanTask`**

In `packages/api-server/src/services/resolve-human-task.ts`, add imports at the top:

```ts
import { applyFirstWinsCancellation } from "@journeyman/orchestrator";
import { recomputeWaitStatus } from "./recompute-wait-status.ts";
```

Then replace the tail of the function — the Conductor completion block and the final `setStatus` — i.e. replace:

```ts
  if (workflowInstance.engineWorkflowId) {
    await c.conductorClient.completeTask({
      workflowInstanceId: workflowInstance.engineWorkflowId,
      taskId: conductorTaskId,
      status: "COMPLETED",
      outputData: output,
    });
  }

  await c.workflowInstances.setStatus(input.workflowInstanceId, "running");
}
```

with:

```ts
  if (workflowInstance.engineWorkflowId) {
    await c.conductorClient.completeTask({
      workflowInstanceId: workflowInstance.engineWorkflowId,
      taskId: conductorTaskId,
      status: "COMPLETED",
      outputData: output,
    });

    // Event-driven first-wins cleanup: cancel the sibling branches of any
    // first-wins join this node feeds, and clear their waiting rows so the
    // derived status and the webhook matcher stay correct.
    try {
      const { cancelled } = await applyFirstWinsCancellation(
        c.conductorClient, workflowInstance.engineWorkflowId,
      );
      for (const losingNodeId of cancelled) {
        const loser = await c.nodeExecutions.latestForNode(input.workflowInstanceId, losingNodeId);
        if (loser && loser.status === "waiting") {
          await c.nodeExecutions.markSkipped(loser.id);
          await c.events.append({
            workflowInstanceId: input.workflowInstanceId,
            nodeId: losingNodeId,
            eventType: "node.resolved",
            payload: { cancelled: true, cancelledBy: "first-wins" },
          });
        }
      }
    } catch {
      // Best-effort — the backstop reconcile will finish cleanup if this throws.
    }
  }

  // Status is derived from remaining waiting rows: running if none, else stays
  // paused (e.g. a wait-all join with another outstanding branch).
  await recomputeWaitStatus(c, input.workflowInstanceId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/api-server/src/services/resolve-human-task.first-wins.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify (no commit — per request).**

---

## Task 7: Reconciler uses derivation + single task fetch

**Files:**
- Modify: `packages/api-server/src/services/engine-reconciler.ts`
- Test: `packages/api-server/src/services/engine-reconciler.status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api-server/src/services/engine-reconciler.status.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { reconcileWorkflowInstance } from "./engine-reconciler.ts";

function makeC(tasks: unknown[], startStatus: string) {
  const instance = { id: "wi", engineWorkflowId: "eng", status: startStatus, definitionSnapshot: { nodes: [] } };
  const sets: string[] = [];
  const c = {
    workflowInstances: {
      getById: vi.fn().mockImplementation(async () => ({ ...instance })),
      setStatus: vi.fn().mockImplementation(async (_id: string, s: string) => { instance.status = s; sets.push(s); }),
    },
    nodeExecutions: {
      latestForNode: vi.fn().mockResolvedValue(null),
      markWaiting: vi.fn().mockResolvedValue({ id: "ne" }),
      markSkipped: vi.fn().mockResolvedValue({ id: "ne" }),
      latestWaitingForInstance: vi.fn().mockImplementation(async () =>
        tasks.some((t: any) => t.taskType === "HUMAN" && t.status === "IN_PROGRESS") ? { id: "ne" } : null),
    },
    events: { append: vi.fn().mockResolvedValue(undefined) },
    humanTaskTimeouts: { schedule: vi.fn() },
    conductorClient: { getWorkflowWithTasks: vi.fn().mockResolvedValue({ status: "RUNNING", tasks }), completeTask: vi.fn() },
  } as never;
  return { c, instance, sets };
}

describe("reconcileWorkflowInstance — status derivation", () => {
  it("sets paused when a HUMAN task is in progress", async () => {
    const { c, instance } = makeC([{ taskId: "h", taskType: "HUMAN", referenceTaskName: "ht", status: "IN_PROGRESS", inputData: {} }], "running");
    await reconcileWorkflowInstance(c, "wi");
    expect(instance.status).toBe("paused");
  });
  it("flips paused → running when no HUMAN task remains and engine RUNNING", async () => {
    const { c, instance } = makeC([], "paused");
    await reconcileWorkflowInstance(c, "wi");
    expect(instance.status).toBe("running");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/api-server/src/services/engine-reconciler.status.test.ts`
Expected: FAIL — the second case stays `paused` (current code never un-pauses).

- [ ] **Step 3: Update the reconciler**

In `packages/api-server/src/services/engine-reconciler.ts`:

Add the import:

```ts
import { recomputeWaitStatus } from "./recompute-wait-status.ts";
```

Replace the explicit pause-setting block:

```ts
  if (humanInProgress.length > 0 && workflowInstance.status !== "paused") {
    await c.workflowInstances.setStatus(workflowInstanceId, "paused");
  }

  try {
    await applyFirstWinsCancellation(c.conductorClient, workflowInstance.engineWorkflowId);
  } catch {
    // Best-effort — never let cancellation failure break reconciliation.
  }

  return { pendingNodeIds };
```

with:

```ts
  // First-wins cleanup, reusing the tasks we already fetched (single round-trip).
  try {
    const { cancelled } = await applyFirstWinsCancellation(
      c.conductorClient, workflowInstance.engineWorkflowId, { tasks: wf.tasks },
    );
    for (const losingNodeId of cancelled) {
      const loser = await c.nodeExecutions.latestForNode(workflowInstanceId, losingNodeId);
      if (loser && loser.status === "waiting") {
        await c.nodeExecutions.markSkipped(loser.id);
        await c.events.append({
          workflowInstanceId, nodeId: losingNodeId,
          eventType: "node.resolved",
          payload: { cancelled: true, cancelledBy: "first-wins" },
        });
      }
    }
  } catch {
    // Best-effort — never let cancellation failure break reconciliation.
  }

  // Derive paused/running from waiting rows. Only un-pause when the engine is
  // actually RUNNING (so a manually-paused / PAUSED workflow is never resumed).
  if (wf.status === "RUNNING") {
    await recomputeWaitStatus(c, workflowInstanceId);
  } else if (humanInProgress.length > 0 && workflowInstance.status !== "paused") {
    await c.workflowInstances.setStatus(workflowInstanceId, "paused");
  }

  return { pendingNodeIds };
```

> `wf` is the result of `getWorkflowWithTasks` already fetched at the top of the function; `getWorkflowWithTasks` returns `{ status, tasks }` (confirmed in `conductor-client.ts`). If `wf.status` is not present on the returned shape, fall back to fetching `getWorkflow(engineWorkflowId).status` once — but verify the shape first; do not guess.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/api-server/src/services/engine-reconciler.status.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify (no commit — per request).**

---

## Task 8: Matcher gate uses terminal check

**Files:**
- Modify: `packages/api-server/src/services/match-human-tasks.ts`
- Test: `packages/api-server/src/services/match-human-tasks.gate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api-server/src/services/match-human-tasks.gate.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { matchAndResolveWebhookWaits } from "./match-human-tasks.ts";

// A RUNNING (non-terminal) instance with a waiting+correlated webhook-wait node
// must be resolved — not skipped for "status !== paused".
describe("matchAndResolveWebhookWaits — gate on terminal, not paused", () => {
  it("resolves a waiting node on a RUNNING instance", async () => {
    const instance = {
      id: "wi", status: "running",
      definitionSnapshot: { nodes: [{ id: "wh", type: "webhook-wait", config: { outputs: [] } }] },
    };
    const resolved: string[] = [];
    const c = {
      nodeExecutions: {
        findAllWaitingWithCorrelation: vi.fn().mockResolvedValue([
          { workflowInstanceId: "wi", nodeId: "wh", correlationEventPath: "$.issue.number", correlationValue: "6" },
        ]),
      },
      workflowInstances: { getById: vi.fn().mockResolvedValue(instance) },
      conditions: { evaluate: vi.fn().mockReturnValue(true) },
      // resolveHumanTask is imported directly; stub via the composition pieces it uses:
      humanTaskTimeouts: { cancel: vi.fn() },
      humanTaskResolutions: { create: vi.fn().mockResolvedValue(undefined) },
      events: { append: vi.fn().mockResolvedValue(undefined) },
      conductorClient: { completeTask: vi.fn().mockResolvedValue(undefined), getWorkflowWithTasks: vi.fn().mockResolvedValue({ status: "RUNNING", tasks: [] }) },
    } as never;

    // Make resolveHumanTask observable by having latestForNode return a waiting exec.
    (c as any).nodeExecutions.latestForNode = vi.fn().mockResolvedValue({ id: "ne", nodeId: "wh", status: "waiting", conductorTaskId: "ct" });
    (c as any).nodeExecutions.markCompleted = vi.fn().mockImplementation(async () => { resolved.push("wh"); return { id: "ne" }; });
    (c as any).nodeExecutions.markSkipped = vi.fn().mockResolvedValue({ id: "ne" });
    (c as any).nodeExecutions.latestWaitingForInstance = vi.fn().mockResolvedValue(null);

    const res = await matchAndResolveWebhookWaits(c, { id: "ev", provider: "github", eventType: "issues", rawPayload: { issue: { number: 6 } } });
    expect(res.matched).toBe(1);
    expect(resolved).toContain("wh");
  });
});
```

> Note: this test exercises `matchAndResolveWebhookWaits` end-to-end through `resolveHumanTask`. If wiring the full path proves brittle, narrow it to assert that the **gate** no longer skips a RUNNING instance (e.g. spy that `resolveHumanTask`'s first DB call happens) — the key behavior is "RUNNING instance is not skipped." Check the existing `match-human-tasks` test, if any, for the established mocking style first.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/api-server/src/services/match-human-tasks.gate.test.ts`
Expected: FAIL — current `instance.status !== "paused"` gate skips the RUNNING instance, so `matched` is 0.

- [ ] **Step 3: Update the gate**

In `packages/api-server/src/services/match-human-tasks.ts`, add the import:

```ts
import { isTerminalStatus } from "@journeyman/core";
```

Replace:

```ts
      const instance = await c.workflowInstances.getById(exec.workflowInstanceId);
      if (!instance || instance.status !== "paused") continue;
```

with:

```ts
      const instance = await c.workflowInstances.getById(exec.workflowInstanceId);
      if (!instance || isTerminalStatus(instance.status)) continue;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/api-server/src/services/match-human-tasks.gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify (no commit — per request).**

---

## Task 9: `syncStatus` defers paused/running to derivation

**Files:**
- Modify: `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`
- Test: `packages/orchestrator/src/engines/conductor/conductor-orchestrator.syncStatus.test.ts`

- [ ] **Step 1: Update the existing tests to the new contract**

In `packages/orchestrator/src/engines/conductor/conductor-orchestrator.syncStatus.test.ts`:

- Change the first test ("does NOT demote a paused instance to running when Conductor reports RUNNING") so it now asserts the status is **left unchanged** by syncStatus (still `paused`, because derivation — not syncStatus — owns the flip):

```ts
  it("leaves a paused instance untouched when Conductor reports RUNNING (derivation owns the flip)", async () => {
    const { deps, setStatus } = makeDeps("paused", "RUNNING");
    const orch = new ConductorOrchestrator(deps);
    const result = await orch.syncStatus("wi");
    expect(result).toBe("paused");
    expect(setStatus).not.toHaveBeenCalled();
  });
```

- Add a test that a `pending` instance reported RUNNING becomes `running`:

```ts
  it("promotes a pending instance to running when Conductor reports RUNNING", async () => {
    const { deps, setStatus } = makeDeps("pending", "RUNNING");
    const orch = new ConductorOrchestrator(deps);
    const result = await orch.syncStatus("wi");
    expect(result).toBe("running");
    expect(setStatus).toHaveBeenCalledWith("wi", "running", expect.anything());
  });
```

(Keep the existing COMPLETED-propagation and running-no-op tests.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/orchestrator/src/engines/conductor/conductor-orchestrator.syncStatus.test.ts`
Expected: FAIL — current sticky guard returns `paused` but the `setStatus not called` / `pending→running` expectations don't hold yet (the guard returns early before the pending case; the no-op assertion differs).

- [ ] **Step 3: Update `syncStatus`**

In `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`, replace the sticky guard block (lines ~167-177):

```ts
    if (instance.status === "paused" && mapped === "running") {
      return "paused";
    }
```

with:

```ts
    // The paused/running distinction for a live (engine-RUNNING) workflow is
    // owned by waiting-row derivation (recomputeWaitStatus / reconcile), NOT by
    // the coarse Conductor status. So when the engine reports RUNNING, only
    // promote a fresh `pending` instance; otherwise leave the stored status
    // (running or derived-paused) untouched. Manual pauses report Conductor
    // PAUSED and fall through to the terminal/non-running handling below.
    if (mapped === "running") {
      if (instance.status === "pending") {
        await this.deps.workflowInstances.setStatus(workflowInstanceId, "running");
        return "running";
      }
      return instance.status;
    }
```

(The existing `mapped === "failed" && retry` block and the `mapped !== instance.status` terminal/paused block below remain unchanged — they now handle COMPLETED/FAILED/CANCELLED and Conductor PAUSED.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/orchestrator/src/engines/conductor/conductor-orchestrator.syncStatus.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify (no commit — per request).**

---

## Task 10: Syncer backstop + suppress duplicate "started"

**Files:**
- Modify: `packages/orchestrator/src/sync/workflow-instance-syncer.ts`
- Modify: `packages/api-server/src/composition.ts` and/or `packages/api-server/src/cli-start.ts` (wire the hook)
- Test: `packages/orchestrator/src/sync/workflow-instance-syncer.test.ts`

- [ ] **Step 1: Write the failing test**

Create (or extend) `packages/orchestrator/src/sync/workflow-instance-syncer.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { WorkflowInstanceSyncer } from "./workflow-instance-syncer.ts";

function makeDeps(instances: Array<{ id: string; status: string }>, liveStatus: string) {
  const reconcilePaused = vi.fn().mockResolvedValue(undefined);
  const append = vi.fn().mockResolvedValue(undefined);
  const deps = {
    workflowInstances: {
      list: vi.fn().mockImplementation(async ({ status }: { status: string }) =>
        instances.filter(i => i.status === status)),
    },
    orchestrator: { syncStatus: vi.fn().mockResolvedValue(liveStatus) },
    events: { append },
    reconcilePaused,
  } as never;
  return { deps, reconcilePaused, append };
}

describe("WorkflowInstanceSyncer", () => {
  it("calls reconcilePaused for paused instances", async () => {
    const { deps, reconcilePaused } = makeDeps([{ id: "p1", status: "paused" }], "paused");
    await new WorkflowInstanceSyncer(deps).syncOnce();
    expect(reconcilePaused).toHaveBeenCalledWith("p1");
  });

  it("does NOT re-emit workflow_instance.started on a paused → running transition", async () => {
    const { deps, append } = makeDeps([{ id: "p1", status: "paused" }], "running");
    await new WorkflowInstanceSyncer(deps).syncOnce();
    const started = append.mock.calls.find(([e]) => e.eventType === "workflow_instance.started");
    expect(started).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/orchestrator/src/sync/workflow-instance-syncer.test.ts`
Expected: FAIL — `reconcilePaused` is not part of the deps/loop, and a paused→running transition currently emits `started`.

- [ ] **Step 3: Update the syncer**

In `packages/orchestrator/src/sync/workflow-instance-syncer.ts`:

Add to the deps interface:

```ts
export interface WorkflowInstanceSyncerDeps {
  workflowInstances: IWorkflowInstanceStore;
  orchestrator: IOrchestratorEngine;
  events: IEventBus;
  intervalMs?: number;
  /**
   * Backstop: reconcile a paused instance (cancel first-wins losers, clear
   * waiting rows, recompute status). Injected by api-server since reconcile
   * lives there. Optional so the orchestrator stays standalone.
   */
  reconcilePaused?: (workflowInstanceId: string) => Promise<void>;
}
```

In `syncOnce`, inside the loop, before calling `syncStatus`, add the backstop call for paused instances, and suppress the duplicate `started`:

```ts
    for (const instance of allActive) {
      const previous = instance.status;

      if (previous === "paused" && this.deps.reconcilePaused) {
        await this.deps.reconcilePaused(instance.id).catch((err) => {
          log.warn({ workflowInstanceId: instance.id, err: err?.message }, "reconcilePaused failed");
        });
      }

      const live = await this.deps.orchestrator.syncStatus(instance.id).catch((err) => {
        log.warn({ workflowInstanceId: instance.id, err: err?.message }, "syncStatus failed");
        return null;
      });
      if (!live || live === previous) continue;

      // A paused → running transition is a resume, not a fresh start; don't
      // re-emit workflow_instance.started.
      if (previous === "paused" && live === "running") continue;

      const eventType = mapStatusToEvent(live);
      if (eventType) {
        await this.deps.events.append({
          workflowInstanceId: instance.id,
          eventType,
          payload: { status: live, previousStatus: previous },
        });
      }
    }
```

> Note: `reconcilePaused` runs first and may change the DB status; `syncStatus` then reads/returns the current status, so `live` reflects the post-reconcile value.

- [ ] **Step 4: Wire the hook in api-server**

In `packages/api-server/src/cli-start.ts`, where the syncer is constructed (around line 47), add the `reconcilePaused` hook:

```ts
const syncer = new WorkflowInstanceSyncer({
  workflowInstances: composition.workflowInstances,
  orchestrator: composition.orchestrator,
  events: composition.events,
  reconcilePaused: (id) => reconcileWorkflowInstance(composition, id).then(() => undefined),
});
```

Add the import at the top of `cli-start.ts` if not present:

```ts
import { reconcileWorkflowInstance } from "./services/engine-reconciler.ts";
```

(Match the exact existing constructor arg names in `cli-start.ts` — adjust `workflowInstances`/`orchestrator`/`events` to whatever the file already passes.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/orchestrator/src/sync/workflow-instance-syncer.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify (no commit — per request).**

---

## Task 11: Final typecheck + full test sweep

**Files:** none

- [ ] **Step 1: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS across all workspaces. Fix any type errors in the touched files before finishing.

- [ ] **Step 2: Re-run all new/affected vitest suites**

Run:
```bash
npx vitest run \
  packages/core/src/types/workflow-instance-status.test.ts \
  packages/orchestrator/src/stores/memory/mark-skipped.test.ts \
  packages/orchestrator/src/stores/memory/matcher-decouple.test.ts \
  packages/orchestrator/src/sync/first-wins-controller.test.ts \
  packages/orchestrator/src/engines/conductor/conductor-orchestrator.syncStatus.test.ts \
  packages/orchestrator/src/sync/workflow-instance-syncer.test.ts \
  packages/api-server/src/services/recompute-wait-status.test.ts \
  packages/api-server/src/services/resolve-human-task.first-wins.test.ts \
  packages/api-server/src/services/engine-reconciler.status.test.ts \
  packages/api-server/src/services/match-human-tasks.gate.test.ts
```
Expected: all PASS.

- [ ] **Step 3: Regression sweep on the affected packages**

Run: `npx vitest run packages/orchestrator/src packages/api-server/src packages/core/src`
Expected: PASS. (Some files are `tsx`-style assert scripts that vitest reports as "No test suite found" — those are not failures; confirm via `npx tsx <file>` if unsure, as in earlier work.)

- [ ] **Step 4: Done — leave all changes uncommitted (per request).**

---

## Self-Review Notes

- **Spec coverage:** derive status from waiting rows (Tasks 4, 7, 9) ✓; event-driven loser cleanup at resolve time (Task 6) ✓; clear loser rows / fix the catch (Tasks 2, 6, 7) ✓; decouple matcher from `paused` (Tasks 3, 8) ✓; `syncStatus` stops managing paused/running + manual-pause via Conductor PAUSED (Task 9) ✓; suppress duplicate `started` (Task 10) ✓; backstop sweep via injected hook (Task 10) ✓; single shared task fetch (Tasks 5, 7) ✓.
- **Manual-pause safety:** `recomputeWaitStatus` only un-pauses from contexts known to be engine-RUNNING (resolve-time; reconcile guarded by `wf.status === "RUNNING"`); `syncStatus` keeps Conductor `PAUSED` as `paused`. No new column needed.
- **Type/name consistency:** `recomputeWaitStatus(c, id)`, `markSkipped(executionId)`, `applyFirstWinsCancellation(client, id, { tasks })`, `isTerminalStatus(status)`, and the syncer dep `reconcilePaused` are used identically across their definition tasks and consumer tasks.
- **Residual (documented in spec):** an unattended *running* instance that silently enters a wait with nobody reading it and no webhook arriving relies on the next backstop tick (which scans `paused`) — newly-waiting detection still rides on reconcile-on-GET / webhook / the backstop; this matches existing behavior and is acceptable. No silent truncation introduced.
- **Test-runner caveat:** a few existing `.test.ts` files in these packages are `tsx`-style assert scripts, not vitest suites; the Task 11 regression sweep notes this so a worker doesn't mistake them for failures.
```
