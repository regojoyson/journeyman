import { describe, it, expect } from "vitest";
import type { WorkflowNode } from "../types/flow.types.ts";
import { joinNodeOutputSchema } from "./join-node-output.ts";

function joinNode(mode?: string): WorkflowNode {
  return { id: "j", type: "join", config: mode ? { mode } : {} } as unknown as WorkflowNode;
}

describe("joinNodeOutputSchema", () => {
  it("first-wins exposes winner + output + results", () => {
    const s = joinNodeOutputSchema(joinNode("first-wins"));
    expect(s && Object.keys(s)).toEqual(["winner", "output", "results"]);
    expect(s!.winner).toEqual({ type: "string" });
  });

  it("wait-all / wait-all-strict expose results only", () => {
    expect(Object.keys(joinNodeOutputSchema(joinNode("wait-all"))!)).toEqual(["results"]);
    expect(Object.keys(joinNodeOutputSchema(joinNode("wait-all-strict"))!)).toEqual(["results"]);
  });

  it("fail-fast contributes no join-level output", () => {
    expect(joinNodeOutputSchema(joinNode("fail-fast"))).toBeNull();
  });

  it("no mode defaults to first-wins (DEFAULT_JOIN_MODE)", () => {
    expect(Object.keys(joinNodeOutputSchema(joinNode())!)).toEqual(["winner", "output", "results"]);
  });

  it("returns null for non-join nodes", () => {
    expect(joinNodeOutputSchema({ id: "s", type: "step", stepType: "custom-ai" } as unknown as WorkflowNode)).toBeNull();
  });
});
