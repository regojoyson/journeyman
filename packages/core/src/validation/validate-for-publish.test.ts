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

describe("validateForPublish — sandbox", () => {
  it("errors when no sandbox is set", () => {
    const r = validateForPublish(flowWith({}), { hasTrigger: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "missing_sandbox")).toBe(true);
  });

  it("passes the sandbox check when defaults.sandboxId is set", () => {
    const r = validateForPublish(flowWith({ sandboxId: "sb1" }), { hasTrigger: true });
    expect(r.errors.some((e) => e.code === "missing_sandbox")).toBe(false);
  });
});
