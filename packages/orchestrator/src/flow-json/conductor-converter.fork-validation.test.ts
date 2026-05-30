import { describe, it, expect } from "vitest";
import type { WorkflowGraph } from "@journeyman/core";
import { ConductorJsonConverter, WorkflowValidationError } from "./conductor-converter.ts";

function n(node: Partial<WorkflowGraph["nodes"][number]> & { id: string; type: string }) {
  return { position: { x: 0, y: 0 }, config: {}, ...node } as unknown as WorkflowGraph["nodes"][number];
}

function validate(graph: WorkflowGraph): unknown {
  try { ConductorJsonConverter.validateGraph(graph); return null; }
  catch (e) { return e; }
}

describe("conductor-converter fork/join structural validation (publish-time)", () => {
  it("flags a Join with no matching Fork as 'join_without_fork'", () => {
    const graph = {
      schemaVersion: 2,
      inputDefs: [],
      nodes: [
        n({ id: "start", type: "trigger-manual" }),
        n({ id: "s", type: "step", stepType: "custom-ai", displayName: "Fan out", inputs: {} }),
        n({ id: "a", type: "step", stepType: "custom-ai", displayName: "Branch A", inputs: {} }),
        n({ id: "b", type: "step", stepType: "custom-ai", displayName: "Branch B", inputs: {} }),
        n({ id: "join", type: "join", displayName: "Join", config: { mode: "first-wins" } }),
        // reads the Join's own output — a valid (dominating) ref, so we reach the fork check.
        n({ id: "c", type: "step", stepType: "custom-ai", displayName: "Reader", inputs: { payload: { kind: "ref", ref: "join.output.winner" } } }),
        n({ id: "end", type: "end" }),
      ],
      edges: [
        { id: "e0", type: "default", source: "start", target: "s" },
        { id: "e1", type: "default", source: "s", target: "a" },
        { id: "e2", type: "default", source: "s", target: "b" },
        { id: "e4", type: "default", source: "a", target: "join" },
        { id: "e5", type: "default", source: "b", target: "join" },
        { id: "e6", type: "default", source: "join", target: "c" },
        { id: "e7", type: "default", source: "c", target: "end" },
      ],
    } as unknown as WorkflowGraph;

    const err = validate(graph);
    expect(err).toBeInstanceOf(WorkflowValidationError);
    expect((err as WorkflowValidationError).diagnostic?.code).toBe("join_without_fork");
    expect((err as WorkflowValidationError).diagnostic?.nodeId).toBe("join");
    expect((err as WorkflowValidationError).diagnostic?.fixes?.length).toBeGreaterThan(0);
  });

  it("accepts a valid Fork → branches → Join (no error)", () => {
    const graph = {
      schemaVersion: 2,
      inputDefs: [],
      nodes: [
        n({ id: "start", type: "trigger-manual" }),
        n({ id: "fork", type: "gateway-and", displayName: "Fork" }),
        n({ id: "a", type: "step", stepType: "custom-ai", displayName: "Branch A", inputs: {} }),
        n({ id: "b", type: "step", stepType: "custom-ai", displayName: "Branch B", inputs: {} }),
        n({ id: "join", type: "join", displayName: "Join", config: { mode: "wait-all" } }),
        n({ id: "c", type: "step", stepType: "custom-ai", displayName: "After", inputs: {} }),
        n({ id: "end", type: "end" }),
      ],
      edges: [
        { id: "e0", type: "default", source: "start", target: "fork" },
        { id: "e1", type: "default", source: "fork", target: "a" },
        { id: "e2", type: "default", source: "fork", target: "b" },
        { id: "e4", type: "default", source: "a", target: "join" },
        { id: "e5", type: "default", source: "b", target: "join" },
        { id: "e6", type: "default", source: "join", target: "c" },
        { id: "e7", type: "default", source: "c", target: "end" },
      ],
    } as unknown as WorkflowGraph;

    expect(validate(graph)).toBeNull();
  });
});
