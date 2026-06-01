import { describe, it, expect } from "vitest";
import { applyFirstWinsCancellation } from "./first-wins-controller.ts";
import type { ConductorClient } from "../engines/conductor/conductor-client.ts";

/**
 * Builds a fake ConductorClient whose getWorkflowWithTasks returns the given
 * tasks, and records every completeTask call. Mirrors the REAL Conductor task
 * shape: for a JOIN system task, Conductor copies `joinOn` into `inputData`
 * but keeps the user-supplied `mode` / `branchTaskRefs` only under
 * `workflowTask.inputParameters` — NOT in `inputData`.
 */
function fakeConductor(tasks: unknown[]) {
  const completed: Array<{ taskId: string }> = [];
  const client = {
    getWorkflowWithTasks: async () => ({
      workflowId: "wf",
      status: "RUNNING" as const,
      tasks,
    }),
    completeTask: async (body: { taskId: string }) => {
      completed.push({ taskId: body.taskId });
    },
  } as unknown as ConductorClient;
  return { client, completed };
}

describe("applyFirstWinsCancellation", () => {
  it("cancels the losing branch when the winner is only described in workflowTask.inputParameters", async () => {
    // Reproduces the real Conductor shape that caused first-wins joins to hang:
    // mode/branchTaskRefs live under workflowTask.inputParameters, joinOn under inputData.
    const { client, completed } = fakeConductor([
      {
        taskId: "human-task-id",
        taskType: "HUMAN",
        referenceTaskName: "human-task_vy3p35",
        status: "COMPLETED",
        inputData: {},
      },
      {
        taskId: "webhook-wait-id",
        taskType: "HUMAN",
        referenceTaskName: "webhook-wait_pbfs1v",
        status: "IN_PROGRESS",
        inputData: {},
      },
      {
        taskId: "join-id",
        taskType: "JOIN",
        referenceTaskName: "join_8a8gat",
        status: "IN_PROGRESS",
        // Conductor only surfaces joinOn here for a JOIN — not mode/branchTaskRefs.
        inputData: { joinOn: ["webhook-wait_pbfs1v", "human-task_vy3p35"] },
        workflowTask: {
          type: "JOIN",
          joinOn: ["webhook-wait_pbfs1v", "human-task_vy3p35"],
          inputParameters: {
            mode: "first-wins",
            branchTaskRefs: [["webhook-wait_pbfs1v"], ["human-task_vy3p35"]],
          },
        },
      },
    ]);

    const { cancelled } = await applyFirstWinsCancellation(client, "engine-wf-id");

    expect(cancelled).toEqual(["webhook-wait_pbfs1v"]);
    expect(completed.map(c => c.taskId)).toEqual(["webhook-wait-id"]);
  });

  it("still locates and resolves a JOIN whose ref was renamed to join_<id>__join", async () => {
    const { client, completed } = fakeConductor([
      { taskId: "ht", taskType: "HUMAN", referenceTaskName: "human-task_vy3p35", status: "COMPLETED", inputData: {} },
      { taskId: "ww", taskType: "HUMAN", referenceTaskName: "webhook-wait_pbfs1v", status: "IN_PROGRESS", inputData: {} },
      {
        taskId: "join-id",
        taskType: "JOIN",
        referenceTaskName: "join_8a8gat__join",
        status: "IN_PROGRESS",
        inputData: { joinOn: ["webhook-wait_pbfs1v", "human-task_vy3p35"] },
        workflowTask: {
          type: "JOIN",
          joinOn: ["webhook-wait_pbfs1v", "human-task_vy3p35"],
          inputParameters: {
            mode: "first-wins",
            branchTaskRefs: [["webhook-wait_pbfs1v"], ["human-task_vy3p35"]],
          },
        },
      },
    ]);

    const { cancelled } = await applyFirstWinsCancellation(client, "wf");
    expect(cancelled).toContain("webhook-wait_pbfs1v");
    expect(completed.map(c => c.taskId)).toContain("ww");
  });

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
    const completed: Array<{ taskId: string }> = [];
    const client = {
      getWorkflowWithTasks: () => { throw new Error("should not fetch"); },
      completeTask: async (b: { taskId: string }) => { completed.push({ taskId: b.taskId }); },
    } as never;

    const { cancelled } = await applyFirstWinsCancellation(client, "wf", { tasks: tasks as never });
    expect(cancelled).toContain("webhook-wait_pbfs1v");
    expect(completed.map(c => c.taskId)).toContain("ww");
  });
});
