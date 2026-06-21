import { describe, it, expect } from "vitest";
import type { WorkflowGraph } from "@journeyman/core";
import { ConductorJsonConverter } from "./conductor-converter.ts";

function n(node: Partial<WorkflowGraph["nodes"][number]> & { id: string; type: string }) {
  return { position: { x: 0, y: 0 }, config: {}, ...node } as unknown as WorkflowGraph["nodes"][number];
}

function graph(startConfig: Record<string, unknown>): WorkflowGraph {
  return {
    schemaVersion: 2,
    inputDefs: [],
    nodes: [
      n({ id: "start", type: "trigger-manual", config: startConfig }),
      n({ id: "step1", type: "step", stepType: "custom-ai", displayName: "S", inputs: {} }),
      n({ id: "end", type: "end" }),
    ],
    edges: [
      { id: "e0", type: "default", source: "start", target: "step1" },
      { id: "e1", type: "default", source: "step1", target: "end" },
    ],
  } as unknown as WorkflowGraph;
}

function stepCaching(startConfig: Record<string, unknown>): unknown {
  const def = new ConductorJsonConverter().toEngineJson(graph(startConfig), {
    workflowName: "w",
    workflowVersion: 1,
  }) as unknown as { tasks: Array<Record<string, unknown>> };
  const step = def.tasks.find((t) => t.taskReferenceName === "step1");
  return (step?.inputParameters as Record<string, unknown>)?.caching;
}

describe("conductor-converter — prompt caching flag injection", () => {
  it("defaults caching to true (literal boolean) on each step", () => {
    expect(stepCaching({})).toBe(true);
  });

  it("propagates a workflow-level caching=false as a literal boolean", () => {
    expect(stepCaching({ caching: false })).toBe(false);
  });
});
