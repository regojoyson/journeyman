import { describe, it, expect } from "vitest";
import type { WorkflowGraph } from "@journeyman/core";
import { ConductorJsonConverter, WorkflowValidationError } from "./conductor-converter.ts";

/**
 * A node that reads an input from a node on a sibling parallel branch must fail
 * validation with a STRUCTURED diagnostic (code "cross_branch_input" + fixes),
 * not just a flat string — the UI renders it as a diagnostic card.
 */
function n(node: Partial<WorkflowGraph["nodes"][number]> & { id: string; type: string }) {
  return { position: { x: 0, y: 0 }, config: {}, ...node } as unknown as WorkflowGraph["nodes"][number];
}

describe("conductor-converter cross-branch input diagnostic", () => {
  it("throws a structured WorkflowValidationError with code 'cross_branch_input'", () => {
    const graph = {
      schemaVersion: 2,
      inputDefs: [],
      nodes: [
        n({ id: "start", type: "trigger-manual" }),
        n({ id: "s", type: "step", stepType: "custom-ai", displayName: "Fan out", inputs: {} }),
        n({ id: "a", type: "step", stepType: "custom-ai", displayName: "Branch A", inputs: {} }),
        n({ id: "b", type: "step", stepType: "custom-ai", displayName: "Branch B", inputs: {} }),
        n({ id: "join", type: "join", displayName: "Join", config: { mode: "wait-all" } }),
        n({
          id: "c",
          type: "step",
          stepType: "custom-ai",
          displayName: "Reader",
          inputs: { payload: { kind: "ref", ref: "a.output.data" } },
        }),
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

    let caught: unknown;
    try {
      ConductorJsonConverter.validateGraph(graph);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WorkflowValidationError);
    const err = caught as WorkflowValidationError;
    expect(err.diagnostic).toBeDefined();
    expect(err.diagnostic!.code).toBe("cross_branch_input");
    expect(err.diagnostic!.nodeId).toBe("c");
    expect(err.diagnostic!.fixes && err.diagnostic!.fixes.length).toBeGreaterThan(0);
    // Error.message is the canonical text form (back-compat / logs).
    expect(err.message).toContain("[cross_branch_input]");
  });
});
