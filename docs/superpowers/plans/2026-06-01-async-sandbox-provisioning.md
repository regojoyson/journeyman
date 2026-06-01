# Async Sandbox Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Docker sandbox provisioning (including image build) off the trigger HTTP request path so webhook/manual triggers return immediately while the run provisions and starts in the background.

**Architecture:** Split `ConductorOrchestrator.submit()` at the request boundary. The request path creates the run instance as `provisioning` and returns instantly; a detached background method (`runStart`) provisions the sandbox and *then* calls `startWorkflow`, preserving the existing "sandbox ready before first task" ordering invariant. A periodic reaper fails runs left stuck in `provisioning` (e.g. after an api-server crash).

**Tech Stack:** TypeScript, Node, Fastify, Conductor, PostgreSQL (`pg`), dockerode, Vitest.

> **Constraints for this plan (from the user):** Do **not** add `git commit` steps. End with a single typecheck/verification task.

**Spec:** [docs/superpowers/specs/2026-06-01-async-sandbox-provisioning-design.md](../specs/2026-06-01-async-sandbox-provisioning-design.md)

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/core/src/types/workflow-instance.types.ts` | `WorkflowInstanceStatus` union | Modify — add `"provisioning"` |
| `packages/core/src/interfaces/orchestrator-engine.interface.ts` | `IOrchestratorEngine.submit` signature | Modify — widen `engineWorkflowId` to `string \| null` |
| `packages/orchestrator/src/sync/workflow-instance-syncer.ts` | Non-terminal status list | Modify — add `"provisioning"` |
| `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts` | `submit()` / new `runStart()` | Modify — split request path from background start |
| `packages/orchestrator/src/sandbox/provisioning-reaper.ts` | Fail runs stuck in `provisioning` | Create |
| `packages/orchestrator/src/stores/postgres/provisioning-queries.ts` | SQL to find stuck provisioning runs | Create |
| `packages/orchestrator/src/index.ts` | Package exports | Modify — export the two new symbols |
| `packages/api-server/src/composition.ts` | Wire the provisioning reaper | Modify |

---

## Task 1: Add `provisioning` workflow-instance status

**Files:**
- Modify: `packages/core/src/types/workflow-instance.types.ts:4-10`
- Test: `packages/core/src/types/workflow-instance-status.test.ts`

- [ ] **Step 1: Add a failing test asserting `provisioning` is non-terminal**

Append this test to `packages/core/src/types/workflow-instance-status.test.ts`:

```typescript
  it("treats provisioning as non-terminal", () => {
    expect(isTerminalStatus("provisioning")).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && npx vitest run src/types/workflow-instance-status.test.ts`
Expected: FAIL — TypeScript error that `"provisioning"` is not assignable to `WorkflowInstanceStatus` (the union does not yet include it).

- [ ] **Step 3: Add `provisioning` to the union**

In `packages/core/src/types/workflow-instance.types.ts`, change:

```typescript
export type WorkflowInstanceStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";
```

to:

```typescript
export type WorkflowInstanceStatus =
  | "pending"
  | "provisioning"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";
```

Leave `TERMINAL_STATUSES` and `isTerminalStatus` unchanged — `provisioning` is intentionally non-terminal.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && npx vitest run src/types/workflow-instance-status.test.ts`
Expected: PASS.

> No DB migration is required: `jm_workflow_instances.status` is `TEXT NOT NULL` with no CHECK constraint ([001_initial.sql](../../../packages/migrations/src/sql/001_initial.sql)).

---

## Task 2: Treat `provisioning` as non-terminal in the syncer

**Files:**
- Modify: `packages/orchestrator/src/sync/workflow-instance-syncer.ts:22`
- Test: `packages/orchestrator/src/sync/workflow-instance-syncer.provisioning.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/sync/workflow-instance-syncer.provisioning.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { WorkflowInstanceSyncer } from "./workflow-instance-syncer.ts";

describe("WorkflowInstanceSyncer provisioning", () => {
  it("polls the provisioning status during a sweep", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const syncer = new WorkflowInstanceSyncer({
      workflowInstances: { list } as never,
      orchestrator: { syncStatus: vi.fn() } as never,
      events: { append: vi.fn() } as never,
    });

    await syncer.syncOnce();

    const polledStatuses = list.mock.calls.map((c) => c[0]?.status);
    expect(polledStatuses).toContain("provisioning");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/orchestrator && npx vitest run src/sync/workflow-instance-syncer.provisioning.test.ts`
Expected: FAIL — `polledStatuses` does not contain `"provisioning"`.

- [ ] **Step 3: Add `provisioning` to `NON_TERMINAL`**

In `packages/orchestrator/src/sync/workflow-instance-syncer.ts:22`, change:

```typescript
const NON_TERMINAL: WorkflowInstanceStatus[] = ["pending", "running", "paused"];
```

to:

```typescript
const NON_TERMINAL: WorkflowInstanceStatus[] = ["pending", "provisioning", "running", "paused"];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/orchestrator && npx vitest run src/sync/workflow-instance-syncer.provisioning.test.ts`
Expected: PASS.

---

## Task 3: Widen the `submit()` return type in the interface

**Files:**
- Modify: `packages/core/src/interfaces/orchestrator-engine.interface.ts:26`

This is a type-only change consumed by Task 4. Widening `engineWorkflowId` from `string` to `string | null` is backwards-compatible: existing implementations returning a `string` still satisfy `string | null`.

- [ ] **Step 1: Change the return type**

In `packages/core/src/interfaces/orchestrator-engine.interface.ts:26`, change:

```typescript
  submit(args: SubmitWorkflowInstanceArgs): Promise<{ workflowInstanceId: string; engineWorkflowId: string }>;
```

to:

```typescript
  submit(args: SubmitWorkflowInstanceArgs): Promise<{ workflowInstanceId: string; engineWorkflowId: string | null }>;
```

- [ ] **Step 2: Verify core still type-checks**

Run: `cd packages/core && npx tsc --noEmit`
Expected: PASS (no errors).

---

## Task 4: Split `submit()` into a fast request path + detached `runStart()`

**Files:**
- Modify: `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts:49-149`
- Test: `packages/orchestrator/src/engines/conductor/conductor-orchestrator.runStart.test.ts`

The current `submit()` does everything inline and awaits `sandboxProvisioner` (the slow build) before returning. We split it: the request path creates the instance as `provisioning` and returns immediately; `runStart()` provisions then starts the workflow, off the request path.

- [ ] **Step 1: Write the failing tests**

Create `packages/orchestrator/src/engines/conductor/conductor-orchestrator.runStart.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { ConductorOrchestrator } from "./conductor-orchestrator.ts";

function makeArgs() {
  return {
    workflowId: "wf-1",
    workflowVersionId: "ver-1",
    workflowNameSnapshot: "demo",
    workflowScopeSnapshot: "org" as const,
    definitionSnapshot: { nodes: [], edges: [], attributeDefs: [], defaults: {} } as never,
    inputs: {},
    startedByUserId: "u-1",
    startedByOrgId: "o-1",
    triggerSource: "webhook" as const,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const created = { id: "wi-1" };
  return {
    deps: {
      client: {
        putWorkflowDef: vi.fn().mockResolvedValue(undefined),
        startWorkflow: vi.fn().mockResolvedValue("eng-1"),
      },
      converter: { toEngineJson: vi.fn().mockReturnValue({ name: "n", version: 1, tasks: [] }) },
      workflowInstances: {
        create: vi.fn().mockResolvedValue(created),
        setStatus: vi.fn().mockResolvedValue(undefined),
        setEngineWorkflowId: vi.fn().mockResolvedValue(undefined),
      },
      workflowInstanceGrants: { createForInstance: vi.fn().mockResolvedValue(undefined) },
      events: { append: vi.fn().mockResolvedValue(undefined) },
      ...overrides,
    } as never,
    created,
  };
}

describe("ConductorOrchestrator async start", () => {
  it("submit() returns immediately with provisioning status and null engineWorkflowId, without awaiting the slow provisioner", async () => {
    let resolveProvision!: () => void;
    const provisionPending = new Promise<void>((r) => { resolveProvision = r; });
    const sandboxProvisioner = vi.fn().mockReturnValue(provisionPending);
    const { deps } = makeDeps({ sandboxProvisioner });
    const orch = new ConductorOrchestrator(deps);

    const result = await orch.submit(makeArgs());

    expect(result).toEqual({ workflowInstanceId: "wi-1", engineWorkflowId: null });
    expect((deps as never as { workflowInstances: { setStatus: ReturnType<typeof vi.fn> } }).workflowInstances.setStatus)
      .toHaveBeenCalledWith("wi-1", "provisioning");
    // startWorkflow must NOT have run yet — the provisioner is still pending.
    expect((deps as never as { client: { startWorkflow: ReturnType<typeof vi.fn> } }).client.startWorkflow)
      .not.toHaveBeenCalled();
    resolveProvision();
  });

  it("runStart() provisions, then starts the workflow, sets running, and records the engine id", async () => {
    const sandboxProvisioner = vi.fn().mockResolvedValue(undefined);
    const { deps } = makeDeps({ sandboxProvisioner });
    const d = deps as never as {
      client: { startWorkflow: ReturnType<typeof vi.fn> };
      workflowInstances: { setStatus: ReturnType<typeof vi.fn>; setEngineWorkflowId: ReturnType<typeof vi.fn> };
    };
    const orch = new ConductorOrchestrator(deps);

    await orch.runStart("wi-1", "journeyman_vver_1", makeArgs());

    expect(sandboxProvisioner).toHaveBeenCalledOnce();
    expect(d.client.startWorkflow).toHaveBeenCalledOnce();
    expect(d.workflowInstances.setEngineWorkflowId).toHaveBeenCalledWith("wi-1", "eng-1");
    expect(d.workflowInstances.setStatus).toHaveBeenCalledWith("wi-1", "running");
    // provision happened before start
    expect(sandboxProvisioner.mock.invocationCallOrder[0])
      .toBeLessThan(d.client.startWorkflow.mock.invocationCallOrder[0]);
  });

  it("runStart() marks the run failed and never starts the workflow when provisioning throws", async () => {
    const sandboxProvisioner = vi.fn().mockRejectedValue(new Error("build boom"));
    const { deps } = makeDeps({ sandboxProvisioner });
    const d = deps as never as {
      client: { startWorkflow: ReturnType<typeof vi.fn> };
      workflowInstances: { setStatus: ReturnType<typeof vi.fn> };
      events: { append: ReturnType<typeof vi.fn> };
    };
    const orch = new ConductorOrchestrator(deps);

    await orch.runStart("wi-1", "journeyman_vver_1", makeArgs());

    expect(d.client.startWorkflow).not.toHaveBeenCalled();
    expect(d.workflowInstances.setStatus).toHaveBeenCalledWith("wi-1", "failed", expect.anything());
    expect(d.events.append).toHaveBeenCalledWith(expect.objectContaining({ eventType: "step.log" }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/orchestrator && npx vitest run src/engines/conductor/conductor-orchestrator.runStart.test.ts`
Expected: FAIL — `orch.runStart` is not a function, and `submit()` currently awaits the provisioner (so `startWorkflow` would have been called / hang).

- [ ] **Step 3: Replace the body of `submit()` and add `runStart()`**

In `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`, replace the entire `submit()` method (lines 49-149) with the following two methods:

```typescript
  async submit(args: SubmitWorkflowInstanceArgs): Promise<{ workflowInstanceId: string; engineWorkflowId: string | null }> {
    const versionSuffix = args.workflowVersionId ? args.workflowVersionId.replace(/-/g, "_") : "unknown";
    const wfName = `journeyman_v${versionSuffix}`;
    const wfDef = this.deps.converter.toEngineJson(args.definitionSnapshot, {
      workflowName: wfName, workflowVersion: 1,
    });

    // Register the def on the request path so a bad def fails the trigger early.
    await this.deps.client.putWorkflowDef(wfDef);

    const instance = await this.deps.workflowInstances.create({
      workflowId: args.workflowId,
      workflowVersionId: args.workflowVersionId,
      workflowNameSnapshot: args.workflowNameSnapshot,
      workflowScopeSnapshot: args.workflowScopeSnapshot,
      definitionSnapshot: args.definitionSnapshot,
      triggerSource: args.triggerSource ?? "api",
      startedByUserId: args.startedByUserId,
      startedByOrgId: args.startedByOrgId,
      inputs: args.inputs,
      triggerNodeId: args.triggerNodeId ?? null,
      webhookEventId: args.webhookEventId ?? null,
      formSubmissionId: args.formSubmissionId ?? null,
    });

    // Mark the run "provisioning" so the UI shows the phase while the sandbox builds.
    await this.deps.workflowInstances.setStatus(instance.id, "provisioning");

    const grantsToWrite: Array<{
      principalType: "user" | "org" | "global";
      principalId: string | null;
      role: "owner" | "editor" | "viewer";
      createdBy: string | null;
    }> = [];
    if (args.startedByUserId) {
      grantsToWrite.push({
        principalType: "user", principalId: args.startedByUserId,
        role: "owner", createdBy: args.startedByUserId,
      });
    }
    if (args.startedByOrgId) {
      grantsToWrite.push({
        principalType: "org", principalId: args.startedByOrgId,
        role: "viewer", createdBy: args.startedByUserId,
      });
    }
    if (grantsToWrite.length > 0) await this.deps.workflowInstanceGrants.createForInstance(instance.id, grantsToWrite);

    // Provision + start happen OFF the request path. Ordering (provision BEFORE
    // startWorkflow) is preserved inside runStart, so the "sandbox ready before the
    // first workspace step" invariant still holds. Provisioning failures mark the run
    // failed (see runStart's catch). A run left in "provisioning" after a crash is
    // reaped by the ProvisioningReaper.
    void this.runStart(instance.id, wfName, args).catch((err) => {
      log.error({ workflowInstanceId: instance.id, err: (err as Error)?.message }, "background run start failed");
    });

    return { workflowInstanceId: instance.id, engineWorkflowId: null };
  }

  /**
   * Provision the run's sandbox, then start the Conductor workflow. Runs detached from
   * submit() so the slow Docker build never blocks the trigger response. Any failure
   * marks the run "failed" and emits a step.log; startWorkflow is skipped, so no orphan
   * Conductor workflow is left behind.
   */
  async runStart(workflowInstanceId: string, wfName: string, args: SubmitWorkflowInstanceArgs): Promise<void> {
    try {
      if (this.deps.sandboxProvisioner) {
        await this.deps.sandboxProvisioner({
          workflowInstanceId,
          workerId: args.definitionSnapshot.defaults?.workerId,
          userId: args.startedByUserId ?? null,
          orgId: args.startedByOrgId ?? null,
        });
      }

      const engineWorkflowId = await this.deps.client.startWorkflow({
        name: wfName,
        version: 1,
        input: {
          ...args.inputs,
          attributes: buildAttributeInputs(args.definitionSnapshot.attributeDefs),
          workflowInstanceId,
          startedByUserId: args.startedByUserId ?? null,
          startedByOrgId: args.startedByOrgId ?? null,
          workflowId: args.workflowId,
        },
      });

      await this.deps.workflowInstances.setEngineWorkflowId(workflowInstanceId, engineWorkflowId);
      await this.deps.workflowInstances.setStatus(workflowInstanceId, "running");

      // Trigger nodes are graph markers, not steps — emit node.resolved so the UI doesn't
      // show the entry node stuck at "pending". Prefer the trigger that fired, else the
      // manual trigger, else any trigger.
      const startNode = (args.triggerNodeId
        ? args.definitionSnapshot.nodes.find((n) => n.id === args.triggerNodeId)
        : null)
        ?? findManualTriggerNode(args.definitionSnapshot)
        ?? args.definitionSnapshot.nodes.find((n) => isTriggerNode(n));
      if (startNode) {
        try {
          await this.deps.events.append({
            workflowInstanceId,
            nodeId: startNode.id,
            eventType: "node.resolved",
            payload: {},
          });
        } catch (err) {
          log.warn(
            { workflowInstanceId, err: (err as Error)?.message },
            "failed to emit start-node resolved event",
          );
        }
      }
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      log.error({ workflowInstanceId, err: message }, "run provisioning/start failed");
      await this.deps.events.append({
        workflowInstanceId,
        eventType: "step.log",
        payload: { line: `Run failed during provisioning: ${message}` },
      }).catch(() => undefined);
      await this.deps.workflowInstances
        .setStatus(workflowInstanceId, "failed", { completedAt: new Date() })
        .catch(() => undefined);
    }
  }
```

Note: `engineWorkflowId` was previously returned from `submit()` after `startWorkflow`. That is now set asynchronously inside `runStart`, so `submit()` returns `engineWorkflowId: null`. Consumers that read it (engine reconciler, human-task resolver, syncer) all guard with `if (!engineWorkflowId) return`, so a provisioning run is safely skipped until it starts.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/orchestrator && npx vitest run src/engines/conductor/conductor-orchestrator.runStart.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 5: Run the existing orchestrator suite to catch regressions**

Run: `cd packages/orchestrator && npx vitest run`
Expected: PASS. (If a pre-existing test asserted `submit()` returns a non-null `engineWorkflowId`, update it to expect `null` and to call `runStart` for the start behavior — the start logic moved there.)

---

## Task 5: `ProvisioningReaper` — fail runs stuck in `provisioning`

**Files:**
- Create: `packages/orchestrator/src/sandbox/provisioning-reaper.ts`
- Test: `packages/orchestrator/src/sandbox/provisioning-reaper.test.ts`

Mirrors the existing `SandboxReaper` ([packages/workers/src/sandbox-reaper.ts](../../../packages/workers/src/sandbox-reaper.ts)): dependency-injected, with `reapOnce()` and a `start()/stop()` loop.

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/sandbox/provisioning-reaper.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { ProvisioningReaper } from "./provisioning-reaper.ts";

describe("ProvisioningReaper", () => {
  it("fails every stuck run and returns the count", async () => {
    const failRun = vi.fn().mockResolvedValue(undefined);
    const reaper = new ProvisioningReaper({
      findStuck: async () => ["a", "b"],
      failRun,
    });

    const reaped = await reaper.reapOnce();

    expect(reaped).toBe(2);
    expect(failRun).toHaveBeenCalledWith("a");
    expect(failRun).toHaveBeenCalledWith("b");
  });

  it("does nothing when no runs are stuck", async () => {
    const failRun = vi.fn();
    const reaper = new ProvisioningReaper({ findStuck: async () => [], failRun });

    const reaped = await reaper.reapOnce();

    expect(reaped).toBe(0);
    expect(failRun).not.toHaveBeenCalled();
  });

  it("continues past a failRun error and counts only successes", async () => {
    const failRun = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const reaper = new ProvisioningReaper({ findStuck: async () => ["a", "b"], failRun });

    const reaped = await reaper.reapOnce();

    expect(reaped).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/orchestrator && npx vitest run src/sandbox/provisioning-reaper.test.ts`
Expected: FAIL — cannot find module `./provisioning-reaper.ts`.

- [ ] **Step 3: Implement the reaper**

Create `packages/orchestrator/src/sandbox/provisioning-reaper.ts`:

```typescript
export interface ProvisioningReaperDeps {
  /** IDs of runs that have been "provisioning" longer than the timeout. */
  findStuck: () => Promise<string[]>;
  /** Mark a stuck run failed (status + event). */
  failRun: (workflowInstanceId: string) => Promise<void>;
  /** Optional logger. */
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Fails workflow runs left in "provisioning" past a timeout — e.g. when the api-server
 * crashed mid-provision and the detached runStart() task that owned them is gone.
 */
export class ProvisioningReaper {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: ProvisioningReaperDeps) {}

  /** One sweep. Returns the number of runs successfully failed. */
  async reapOnce(): Promise<number> {
    const stuck = await this.deps.findStuck();
    let reaped = 0;
    for (const id of stuck) {
      try {
        await this.deps.failRun(id);
        reaped += 1;
        this.deps.log?.(`failed stuck provisioning run ${id}`, { workflowInstanceId: id });
      } catch (err) {
        this.deps.log?.(`failed to reap provisioning run ${id}`, { workflowInstanceId: id, err: String(err) });
      }
    }
    return reaped;
  }

  /** Start a periodic reap loop. Returns a stop fn. */
  start(intervalMs = 60_000): () => void {
    if (this.timer) return () => this.stop();
    this.timer = setInterval(() => { void this.reapOnce(); }, intervalMs);
    if (typeof this.timer === "object" && "unref" in this.timer) (this.timer as { unref: () => void }).unref();
    return () => this.stop();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/orchestrator && npx vitest run src/sandbox/provisioning-reaper.test.ts`
Expected: PASS (all three tests).

---

## Task 6: `findStuckProvisioningRuns` SQL query

**Files:**
- Create: `packages/orchestrator/src/stores/postgres/provisioning-queries.ts`
- Test: `packages/orchestrator/src/stores/postgres/provisioning-queries.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/stores/postgres/provisioning-queries.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { findStuckProvisioningRuns } from "./provisioning-queries.ts";

describe("findStuckProvisioningRuns", () => {
  it("returns the ids of stuck provisioning runs and passes the timeout param", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "wi-1" }, { id: "wi-2" }] });
    const pool = { query } as never;

    const ids = await findStuckProvisioningRuns(pool, 600_000);

    expect(ids).toEqual(["wi-1", "wi-2"]);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("status = 'provisioning'");
    expect(params).toEqual([600_000]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/orchestrator && npx vitest run src/stores/postgres/provisioning-queries.test.ts`
Expected: FAIL — cannot find module `./provisioning-queries.ts`.

- [ ] **Step 3: Implement the query**

Create `packages/orchestrator/src/stores/postgres/provisioning-queries.ts`:

```typescript
import type { Pool } from "pg";

/** IDs of runs that have been in "provisioning" for longer than `olderThanMs`. */
export async function findStuckProvisioningRuns(pool: Pool, olderThanMs: number): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT id FROM jm_workflow_instances
       WHERE status = 'provisioning'
         AND created_at < now() - make_interval(secs => $1 / 1000.0)`,
    [olderThanMs],
  );
  return (rows as Array<{ id: string }>).map((r) => r.id);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/orchestrator && npx vitest run src/stores/postgres/provisioning-queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Export both new symbols from the orchestrator package**

In `packages/orchestrator/src/index.ts`, add (near the other store/worker exports):

```typescript
export { ProvisioningReaper } from "./sandbox/provisioning-reaper.ts";
export type { ProvisioningReaperDeps } from "./sandbox/provisioning-reaper.ts";
export { findStuckProvisioningRuns } from "./stores/postgres/provisioning-queries.ts";
```

---

## Task 7: Wire the provisioning reaper into composition

**Files:**
- Modify: `packages/api-server/src/composition.ts` (imports near lines 24-55; reaper setup near lines 199-208; shutdown at line 238)

This is integration wiring; it is covered by the type-check and by the unit tests in Tasks 5-6. No new unit test (composition assembles real infrastructure).

- [ ] **Step 1: Import the new symbols**

In the `from "@journeyman/orchestrator"` import block (lines 24-55) of `packages/api-server/src/composition.ts`, add:

```typescript
  ProvisioningReaper,
  findStuckProvisioningRuns,
```

- [ ] **Step 2: Construct and start the reaper**

Immediately after the existing sandbox reaper block (after line 207, where `reaperStop = reaper.start(...)`), add:

```typescript
  let provisioningReaperStop: (() => void) | undefined;
  if (pool) {
    const PROVISION_TIMEOUT_MS = Number(process.env.PROVISION_TIMEOUT_MS ?? 600_000);
    const provisioningReaper = new ProvisioningReaper({
      findStuck: () => findStuckProvisioningRuns(pool!, PROVISION_TIMEOUT_MS),
      failRun: async (id) => {
        await events
          .append({ workflowInstanceId: id, eventType: "step.log", payload: { line: "Run failed: sandbox provisioning timed out" } })
          .catch(() => undefined);
        await workflowInstances.setStatus(id, "failed", { completedAt: new Date() });
      },
    });
    provisioningReaperStop = provisioningReaper.start(Number(process.env.PROVISION_REAP_INTERVAL_MS ?? 60_000));
  }
```

> The existing `SandboxReaper` separately reaps the Docker container/volume once the run is terminal, so failing the run here is sufficient — no direct sandbox teardown is needed in `failRun`.

- [ ] **Step 3: Stop the reaper on shutdown**

At line 238, change:

```typescript
    shutdown: async () => { reaperStop?.(); if (pool) await pool.end(); },
```

to:

```typescript
    shutdown: async () => { reaperStop?.(); provisioningReaperStop?.(); if (pool) await pool.end(); },
```

- [ ] **Step 4: Type-check api-server**

Run: `cd packages/api-server && npx tsc --noEmit`
Expected: PASS. (If `flows.ts` or any caller now mismatches on the `engineWorkflowId` type, it should resolve cleanly since the value is `null`, which the response object accepts.)

---

## Task 8: Final verification

- [ ] **Step 1: Full type-check across the workspace**

Run (from repo root): `npm run typecheck`
Expected: PASS — no type errors.

- [ ] **Step 2: Import-boundary check**

Run (from repo root): `npm run check:boundaries`
Expected: PASS — no boundary violations (the new files only import within their package and from `pg`).

- [ ] **Step 3: Run the affected test suites**

Run: `cd packages/core && npx vitest run` then `cd packages/orchestrator && npx vitest run`
Expected: PASS — all tests green, including the new tests from Tasks 1, 2, 4, 5, and 6.

- [ ] **Step 4: Confirm the behavior end-to-end (manual, optional)**

Start infra + api-server + worker, add a Docker worker with a custom Dockerfile to a workflow, and fire a trigger (webhook or the Run button). Confirm:
- The trigger HTTP response returns in well under the image-build time.
- The run appears immediately and shows `provisioning`, then transitions to `running`.
- Forcing a build failure (e.g. a broken Dockerfile) results in a `failed` run with a `step.log` describing the failure.
