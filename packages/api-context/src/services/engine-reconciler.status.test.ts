import { describe, it, expect, vi } from "vitest";
import { reconcileWorkflowInstance } from "./engine-reconciler.ts";

function makeC(tasks: unknown[], startStatus: string) {
  const instance = { id: "wi", engineWorkflowId: "eng", status: startStatus, definitionSnapshot: { nodes: [] } };
  const c = {
    workflowInstances: {
      getById: vi.fn().mockImplementation(async () => ({ ...instance })),
      setStatus: vi.fn().mockImplementation(async (_id: string, s: string) => { instance.status = s; }),
    },
    nodeExecutions: {
      latestForNode: vi.fn().mockResolvedValue(null),
      markWaiting: vi.fn().mockResolvedValue({ id: "ne" }),
      markSkipped: vi.fn().mockResolvedValue({ id: "ne" }),
      latestWaitingForInstance: vi.fn().mockImplementation(async () =>
        (tasks as Array<{ taskType: string; status: string }>).some(t => t.taskType === "HUMAN" && t.status === "IN_PROGRESS") ? { id: "ne" } : null),
    },
    events: { append: vi.fn().mockResolvedValue(undefined) },
    humanTaskTimeouts: { schedule: vi.fn() },
    conductorClient: { getWorkflowWithTasks: vi.fn().mockResolvedValue({ status: "RUNNING", tasks }), completeTask: vi.fn() },
  } as never;
  return { c, instance };
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
