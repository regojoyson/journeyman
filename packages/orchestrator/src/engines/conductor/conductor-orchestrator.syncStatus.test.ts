import { describe, it, expect, vi } from "vitest";
import { ConductorOrchestrator } from "./conductor-orchestrator.ts";

/**
 * Regression: a workflow waiting on a HUMAN task (human-task / webhook-wait) is
 * `paused` in our model, but Conductor still reports the workflow as RUNNING
 * (we never call pauseWorkflow for HUMAN waits). The 1.5s syncer must NOT demote
 * such an instance back to `running` — doing so flaps the status and makes the
 * webhook matcher (WHERE wi.status='paused') unable to find the waiting node.
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
