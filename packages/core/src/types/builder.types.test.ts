import { describe, it, expect } from "vitest";
import type { BuildPlan, StepBinding, Gap, ProposedCustomStep } from "./builder.types.ts";

describe("builder.types", () => {
  it("a BuildPlan object satisfies the contract", () => {
    const proposed: ProposedCustomStep = {
      id: "tmp-1",
      step: { name: "Security review" },
    };
    const binding: StepBinding = {
      nodeId: "n1",
      stepKind: "ai",
      uses: { tools: ["read-file", "search"], model: "claude-opus" },
      io: { inputs: [{ name: "diff", from: "step 2 · output diff" }], outputs: [{ name: "findings", type: "json" }] },
    };
    const gap: Gap = {
      id: "g1", kind: "not-implemented", nodeIds: ["n4"],
      reason: "Slack send is not implemented yet.", required: true, fixHint: null,
    };
    const plan: BuildPlan = {
      newCustomSteps: [proposed],
      workflow: { schemaVersion: 2, nodes: [], edges: [] },
      defaults: { sandboxId: null, model: null },
      stepBindings: [binding],
      gaps: [gap],
      summary: "Reviews PRs for security and comments.",
    };
    expect(plan.summary).toContain("security");
    expect(plan.newCustomSteps[0].id).toBe("tmp-1");
    expect(plan.stepBindings[0].stepKind).toBe("ai");
    expect(plan.gaps[0].kind).toBe("not-implemented");
  });
});
