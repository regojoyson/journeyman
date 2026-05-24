import { describe, it, expect } from "vitest";
import { computeNodeStatuses } from "./compute-node-status.ts";
import type { WorkflowGraph, WorkflowInstanceEvent } from "@journeyman/core";

const wf: WorkflowGraph = {
  nodes: [
    { id: "n", type: "step", config: {} } as any,
  ],
  edges: [],
} as any;

function ev(eventType: any, nodeId: string, payload: any = {}, id = 1): WorkflowInstanceEvent {
  return { id, workflowInstanceId: "wf-1", nodeId, eventType, payload, ts: new Date() };
}

describe("computeNodeStatuses — new event types", () => {
  it("marks a node as skipped on step.skipped", () => {
    const map = computeNodeStatuses({
      workflow: wf,
      events: [ev("step.skipped", "n", {})],
      executions: [],
      workflowInstanceStatus: "running",
    });
    expect(map.get("n")?.status).toBe("skipped");
  });
});
