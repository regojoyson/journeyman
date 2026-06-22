import { describe, it, expect, vi } from "vitest";
import { ConductorOrchestrator } from "./conductor-orchestrator.ts";

/**
 * A workflow waiting on a HUMAN task is `paused` in our model while Conductor
 * still reports RUNNING. syncStatus must not overwrite the stored running/paused
 * value when the engine is RUNNING — the paused/running distinction is owned by
 * waiting-row derivation (recomputeWaitStatus). syncStatus only propagates
 * terminal/PAUSED states and promotes a fresh `pending` instance.
 */
function makeDeps(instanceStatus: string, conductorStatus: string) {
  const setStatus = vi.fn().mockResolvedValue(undefined);
  const getWorkflow = vi.fn().mockResolvedValue({ status: conductorStatus, output: {} });
  const getWorkflowWithTasks = vi.fn().mockResolvedValue({ tasks: [] });
  const deps = {
    client: { getWorkflow, getWorkflowWithTasks } as any,
    converter: {} as any,
    workflowInstances: {
      getById: vi.fn().mockResolvedValue({
        id: "wi-1",
        engineWorkflowId: "eng-1",
        status: instanceStatus,
        startedAt: new Date(0),
        attemptNumber: 1,
        definitionSnapshot: { nodes: [], edges: [] },
      }),
      setStatus,
    } as any,
    workflowInstanceGrants: {} as any,
    events: { append: vi.fn().mockResolvedValue(undefined) } as any,
  };
  return { deps, setStatus, getWorkflow };
}

describe("ConductorOrchestrator.syncStatus", () => {
  it("does NOT demote a paused instance to running when Conductor reports RUNNING", async () => {
    const { deps, setStatus } = makeDeps("paused", "RUNNING");
    const orch = new ConductorOrchestrator(deps);

    const result = await orch.syncStatus("wi-1");

    expect(result).toBe("paused");
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("still propagates a terminal status (COMPLETED) from a paused instance", async () => {
    const { deps, setStatus } = makeDeps("paused", "COMPLETED");
    const orch = new ConductorOrchestrator(deps);

    const result = await orch.syncStatus("wi-1");

    expect(result).toBe("completed");
    expect(setStatus).toHaveBeenCalledWith("wi-1", "completed", expect.anything());
  });

  it("normally syncs a running instance that Conductor reports as RUNNING (no-op)", async () => {
    const { deps, setStatus } = makeDeps("running", "RUNNING");
    const orch = new ConductorOrchestrator(deps);

    const result = await orch.syncStatus("wi-1");

    expect(result).toBe("running");
    expect(setStatus).not.toHaveBeenCalled();
  });
});

/**
 * When Conductor 404s a workflow id (getWorkflow returns null), the run is an
 * orphan — the engine no longer knows it. We reconcile it to terminal so the
 * syncer stops polling forever, but only after consecutive 404s (guard against
 * the start race where a just-submitted workflow briefly 404s), and never via
 * the retrying `failed` path.
 */
function makeNotFoundDeps() {
  const setStatus = vi.fn().mockResolvedValue(undefined);
  const getWorkflow = vi.fn();
  const sandboxReaper = vi.fn().mockResolvedValue(undefined);
  const deps = {
    client: {
      getWorkflow,
      getWorkflowWithTasks: vi.fn().mockResolvedValue({ tasks: [] }),
    } as any,
    converter: {} as any,
    workflowInstances: {
      getById: vi.fn().mockResolvedValue({
        id: "wi-1",
        engineWorkflowId: "eng-1",
        status: "running",
        startedAt: new Date(0),
        attemptNumber: 1,
        definitionSnapshot: { nodes: [], edges: [] },
      }),
      setStatus,
    } as any,
    workflowInstanceGrants: {} as any,
    events: { append: vi.fn().mockResolvedValue(undefined) } as any,
    sandboxReaper,
  };
  return { deps, setStatus, getWorkflow, sandboxReaper };
}

describe("ConductorOrchestrator.syncStatus — Conductor 404 (orphan)", () => {
  it("does NOT mark terminal on a single 404 (start-race grace)", async () => {
    const { deps, setStatus, getWorkflow } = makeNotFoundDeps();
    getWorkflow.mockResolvedValue(null);
    const orch = new ConductorOrchestrator(deps);

    const result = await orch.syncStatus("wi-1");

    expect(result).toBe("running");
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("reconciles to cancelled after consecutive 404s", async () => {
    const { deps, setStatus, getWorkflow, sandboxReaper } = makeNotFoundDeps();
    getWorkflow.mockResolvedValue(null);
    const orch = new ConductorOrchestrator(deps);

    await orch.syncStatus("wi-1"); // 1st 404 — grace
    const result = await orch.syncStatus("wi-1"); // 2nd — reconcile

    expect(result).toBe("cancelled");
    expect(setStatus).toHaveBeenCalledWith("wi-1", "cancelled", expect.anything());
    expect(sandboxReaper).toHaveBeenCalledWith("wi-1");
  });

  it("resets the 404 counter after a successful read", async () => {
    const { deps, setStatus, getWorkflow } = makeNotFoundDeps();
    const orch = new ConductorOrchestrator(deps);

    getWorkflow.mockResolvedValueOnce(null); // 1st 404
    await orch.syncStatus("wi-1");
    getWorkflow.mockResolvedValueOnce({ status: "RUNNING", output: {} }); // success resets
    await orch.syncStatus("wi-1");
    getWorkflow.mockResolvedValueOnce(null); // lone 404 again — must NOT terminate
    const result = await orch.syncStatus("wi-1");

    expect(result).toBe("running");
    expect(setStatus).not.toHaveBeenCalledWith("wi-1", "cancelled", expect.anything());
  });

  it("propagates a non-404 getWorkflow error without marking terminal", async () => {
    const { deps, setStatus, getWorkflow } = makeNotFoundDeps();
    getWorkflow.mockRejectedValue(new Error("Conductor GET → 503"));
    const orch = new ConductorOrchestrator(deps);

    await expect(orch.syncStatus("wi-1")).rejects.toThrow("503");
    expect(setStatus).not.toHaveBeenCalled();
  });

  /**
   * Regression: a run that already completed must never be resurrected and
   * cancelled by a later sync. Conductor archives/forgets finished workflows,
   * so a getWorkflow 404 on a terminal instance is EXPECTED — it means "the
   * engine garbage-collected a finished run", not "an active run was lost".
   * syncStatus must short-circuit on terminal instances before ever calling
   * the engine, so the 404-reconcile path can't overwrite `completed`.
   */
  it("does NOT re-sync or cancel an already-completed instance whose engine 404s", async () => {
    const { deps, setStatus, getWorkflow } = makeNotFoundDeps();
    deps.workflowInstances.getById = vi.fn().mockResolvedValue({
      id: "wi-1",
      engineWorkflowId: "eng-1",
      status: "completed",
      startedAt: new Date(0),
      attemptNumber: 1,
      definitionSnapshot: { nodes: [], edges: [] },
    });
    getWorkflow.mockResolvedValue(null); // Conductor has forgotten the finished run
    const orch = new ConductorOrchestrator(deps);

    // Two views of the finished run page — exactly the trigger that flipped a
    // completed run to cancelled in production (NOT_FOUND_TERMINAL_THRESHOLD=2).
    await orch.syncStatus("wi-1");
    const result = await orch.syncStatus("wi-1");

    expect(result).toBe("completed");
    expect(setStatus).not.toHaveBeenCalled();
    expect(getWorkflow).not.toHaveBeenCalled();
  });
});
