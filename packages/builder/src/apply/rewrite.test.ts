import { describe, it, expect } from "vitest";
import { rewriteCustomStepIds } from "./rewrite.ts";
import type { WorkflowGraph } from "@journeyman/core";

function graph(nodes: WorkflowGraph["nodes"]): WorkflowGraph {
  return { schemaVersion: 2, nodes, edges: [] };
}

describe("rewriteCustomStepIds", () => {
  it("replaces placeholder customStepId on custom-ai nodes", () => {
    const g = graph([
      { id: "n_1", type: "step", stepType: "custom-ai", config: { customStepId: "tmp-a", tools: ["read-file"] }, position: { x: 0, y: 0 } },
      { id: "n_2", type: "step", stepType: "get-issue", config: {}, position: { x: 1, y: 0 } },
    ]);
    const out = rewriteCustomStepIds(g, { "tmp-a": "real-123" });
    expect(out.nodes[0].config!.customStepId).toBe("real-123");
    expect(out.nodes[0].config!.tools).toEqual(["read-file"]); // other config untouched
    expect(out.nodes[1].config).toEqual({}); // non-custom-ai untouched
  });

  it("leaves ids that are not in the map unchanged", () => {
    const g = graph([
      { id: "n_1", type: "step", stepType: "custom-ai", config: { customStepId: "already-real" }, position: { x: 0, y: 0 } },
    ]);
    const out = rewriteCustomStepIds(g, { "tmp-a": "real-123" });
    expect(out.nodes[0].config!.customStepId).toBe("already-real");
  });

  it("does not mutate the input graph", () => {
    const g = graph([
      { id: "n_1", type: "step", stepType: "custom-ai", config: { customStepId: "tmp-a" }, position: { x: 0, y: 0 } },
    ]);
    rewriteCustomStepIds(g, { "tmp-a": "real-123" });
    expect(g.nodes[0].config!.customStepId).toBe("tmp-a"); // original unchanged
  });
});
