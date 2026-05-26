import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { NodeExecution, WorkflowInstance } from "@journeyman/core";
import {
  MemoryWorkflowInstanceStore,
  MemoryNodeExecutionStore,
} from "./memory-workflow-instance-store.ts";

function seedInstance(
  store: MemoryWorkflowInstanceStore,
  id: string,
  status: "paused" | "running" | "completed",
): WorkflowInstance {
  const instance: WorkflowInstance = {
    id,
    workflowId: null,
    workflowVersionId: null,
    workflowNameSnapshot: "test",
    workflowScopeSnapshot: "user",
    definitionSnapshot: { schemaVersion: 2, inputs: [], nodes: [], edges: [] } as never,
    status,
    triggerSource: "manual",
    startedByUserId: null,
    engineWorkflowId: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    failedAtNodeId: null,
    inputs: {},
    outputs: null,
    attemptNumber: 1,
    webhookEventId: null,
    triggerNodeId: null,
    formSubmissionId: null,
  };
  // Internal: poke directly into the map via the helper.
  (store as unknown as { rows: Map<string, WorkflowInstance> }).rows.set(id, instance);
  return instance;
}

function seedExec(
  store: MemoryNodeExecutionStore,
  id: string,
  workflowInstanceId: string,
  status: "waiting" | "completed",
  startedAtMs: number,
): NodeExecution {
  const row: NodeExecution = {
    id,
    workflowInstanceId,
    nodeId: "n1",
    attempt: 1,
    status,
    startedAt: new Date(startedAtMs),
    completedAt: null,
    input: {},
    output: null,
    errorClass: null,
    errorMessage: null,
    conductorTaskId: `ct-${id}`,
  };
  void store.upsert(row);
  return row;
}

describe("MemoryNodeExecutionStore.listOverAgePausedNodeExecutions", () => {
  let instances: MemoryWorkflowInstanceStore;
  let execs: MemoryNodeExecutionStore;
  const now = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    instances = new MemoryWorkflowInstanceStore();
    execs = new MemoryNodeExecutionStore(instances);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns only waiting executions on paused instances older than maxAgeMs", async () => {
    seedInstance(instances, "inst-old", "paused");
    seedExec(execs, "exec-old", "inst-old", "waiting", now - 7_200_000); // 2h ago

    seedInstance(instances, "inst-new", "paused");
    seedExec(execs, "exec-new", "inst-new", "waiting", now - 600_000); // 10m ago

    // completed node on a paused instance — must be excluded
    seedInstance(instances, "inst-done", "paused");
    seedExec(execs, "exec-done", "inst-done", "completed", now - 7_200_000);

    // waiting node on a non-paused instance — must be excluded
    seedInstance(instances, "inst-running", "running");
    seedExec(execs, "exec-running", "inst-running", "waiting", now - 7_200_000);

    const result = await execs.listOverAgePausedNodeExecutions(3_600_000, 100);

    expect(result.map(r => r.id)).toEqual(["exec-old"]);
  });

  it("honours the limit", async () => {
    for (let i = 0; i < 5; i++) {
      seedInstance(instances, `inst-${i}`, "paused");
      seedExec(execs, `exec-${i}`, `inst-${i}`, "waiting", now - 7_200_000 - i * 1000);
    }
    const result = await execs.listOverAgePausedNodeExecutions(3_600_000, 2);
    expect(result).toHaveLength(2);
  });

  it("returns empty when no instances store is wired (defensive default)", async () => {
    const detached = new MemoryNodeExecutionStore();
    expect(await detached.listOverAgePausedNodeExecutions(1_000, 100)).toEqual([]);
  });
});
