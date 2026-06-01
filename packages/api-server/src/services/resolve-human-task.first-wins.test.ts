import { describe, it, expect, vi } from "vitest";
import { resolveHumanTask } from "./resolve-human-task.ts";

function buildComposition() {
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
  const execs: Record<string, { id: string; nodeId: string; status: string; conductorTaskId: string }> = {
    wh: { id: "ne-wh", nodeId: "wh", status: "waiting", conductorTaskId: "ct-wh" },
    ht: { id: "ne-ht", nodeId: "ht", status: "waiting", conductorTaskId: "ct-ht" },
  };
  const c = {
    workflowInstances: {
      getById: vi.fn().mockImplementation(async () => ({ ...instance })),
      setStatus: vi.fn().mockImplementation(async (_id: string, s: string) => { instance.status = s; }),
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
      getWorkflowWithTasks: vi.fn().mockResolvedValue({ status: "RUNNING", tasks: [
        { taskId: "ct-wh", taskType: "HUMAN", referenceTaskName: "wh", status: "COMPLETED", inputData: {} },
        { taskId: "ct-ht", taskType: "HUMAN", referenceTaskName: "ht", status: "IN_PROGRESS", inputData: {} },
        { taskId: "j", taskType: "JOIN", referenceTaskName: "join", status: "IN_PROGRESS",
          inputData: { joinOn: ["wh", "ht"] },
          workflowTask: { type: "JOIN", joinOn: ["wh", "ht"], inputParameters: { mode: "first-wins", branchTaskRefs: [["wh"], ["ht"]] } } },
      ] }),
    },
  } as never;
  return { c, instance, skipped, events };
}

describe("resolveHumanTask — first-wins event-driven cleanup", () => {
  it("cancels the loser, marks its row skipped, emits node.resolved, and flips to running", async () => {
    const { c, instance, skipped, events } = buildComposition();
    await resolveHumanTask(c, { workflowInstanceId: "wi", nodeId: "wh", values: {}, actor: null, source: "webhook" });

    expect(skipped).toContain("ne-ht");
    expect(events.some(e => e.nodeId === "ht" && e.eventType === "node.resolved")).toBe(true);
    expect(instance.status).toBe("running");
  });
});
