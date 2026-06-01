import { describe, it, expect } from "vitest";
import type { WorkflowGraph } from "@journeyman/core";
import { ConductorJsonConverter } from "./conductor-converter.ts";

function n(node: Partial<WorkflowGraph["nodes"][number]> & { id: string; type: string }) {
  return { position: { x: 0, y: 0 }, config: {}, ...node } as unknown as WorkflowGraph["nodes"][number];
}

function forkJoinGraph(joinMode: string): WorkflowGraph {
  return {
    schemaVersion: 2,
    inputDefs: [],
    nodes: [
      n({ id: "start", type: "trigger-manual" }),
      n({ id: "fork", type: "gateway-and", displayName: "Fork" }),
      n({ id: "a", type: "step", stepType: "custom-ai", displayName: "A", inputs: {} }),
      n({ id: "b", type: "step", stepType: "custom-ai", displayName: "B", inputs: {} }),
      n({ id: "join", type: "join", displayName: "Join", config: { mode: joinMode } }),
      n({ id: "reader", type: "step", stepType: "custom-ai", displayName: "Reader", inputs: {} }),
      n({ id: "end", type: "end" }),
    ],
    edges: [
      { id: "e0", type: "default", source: "start", target: "fork" },
      { id: "e1", type: "default", source: "fork", target: "a" },
      { id: "e2", type: "default", source: "fork", target: "b" },
      { id: "e3", type: "default", source: "a", target: "join" },
      { id: "e4", type: "default", source: "b", target: "join" },
      { id: "e5", type: "default", source: "join", target: "reader" },
      { id: "e6", type: "default", source: "reader", target: "end" },
    ],
  } as unknown as WorkflowGraph;
}

function findTask(def: { tasks: Array<Record<string, unknown>> }, predicate: (t: Record<string, unknown>) => boolean) {
  return def.tasks.find(predicate);
}

describe("conductor-converter — join finalize", () => {
  it("first-wins: renames JOIN and emits a join-finalize task owning the node id", () => {
    const def = new ConductorJsonConverter().toEngineJson(forkJoinGraph("first-wins"), {
      workflowName: "fj", workflowVersion: 1,
    }) as unknown as { tasks: Array<Record<string, unknown>> };

    const join = findTask(def, (t) => t.type === "JOIN");
    expect(join?.taskReferenceName).toBe("join__join");

    const finalize = findTask(def, (t) => t.name === "join-finalize");
    expect(finalize).toBeDefined();
    expect(finalize?.taskReferenceName).toBe("join");
    const ip = finalize?.inputParameters as Record<string, unknown>;
    expect(ip.raw).toBe("${join__join.output}");
    expect(ip.mode).toBe("first-wins");
    expect(ip.branchTaskRefs).toEqual([["a"], ["b"]]);
  });

  it("wait-all: also emits a join-finalize task", () => {
    const def = new ConductorJsonConverter().toEngineJson(forkJoinGraph("wait-all"), {
      workflowName: "fj", workflowVersion: 1,
    }) as unknown as { tasks: Array<Record<string, unknown>> };
    expect(findTask(def, (t) => t.type === "JOIN")?.taskReferenceName).toBe("join__join");
    expect(findTask(def, (t) => t.name === "join-finalize")).toBeDefined();
  });

  it("fail-fast: JOIN keeps the node id and no finalize task is emitted", () => {
    const def = new ConductorJsonConverter().toEngineJson(forkJoinGraph("fail-fast"), {
      workflowName: "fj", workflowVersion: 1,
    }) as unknown as { tasks: Array<Record<string, unknown>> };
    expect(findTask(def, (t) => t.type === "JOIN")?.taskReferenceName).toBe("join");
    expect(findTask(def, (t) => t.name === "join-finalize")).toBeUndefined();
  });
});
