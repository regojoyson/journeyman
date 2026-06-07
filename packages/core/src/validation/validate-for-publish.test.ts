import { describe, it, expect } from "vitest";
import { validateForPublish } from "./validate-for-publish.ts";
import type { WorkflowGraph } from "../types/flow.types.ts";

function flowWith(defaults: Record<string, unknown>): WorkflowGraph {
  return {
    nodes: [
      { id: "t", type: "trigger-manual", position: { x: 0, y: 0 } },
      { id: "e", type: "end", position: { x: 1, y: 0 } },
    ],
    edges: [{ id: "t_e", type: "default", source: "t", target: "e" }],
    defaults,
  } as unknown as WorkflowGraph;
}

describe("validateForPublish — compute target", () => {
  it("errors when no compute target is set", () => {
    const r = validateForPublish(flowWith({}), { hasTrigger: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "missing_compute_target")).toBe(true);
  });

  it("passes the compute-target check when defaults.computeTargetId is set", () => {
    const r = validateForPublish(flowWith({ computeTargetId: "ct1" }), { hasTrigger: true });
    expect(r.errors.some((e) => e.code === "missing_compute_target")).toBe(false);
  });

  it("accepts the legacy defaults.workerId field", () => {
    const r = validateForPublish(flowWith({ workerId: "ct1" }), { hasTrigger: true });
    expect(r.errors.some((e) => e.code === "missing_compute_target")).toBe(false);
  });
});
