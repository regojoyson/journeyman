import { describe, it, expect } from "vitest";
import type { WorkflowNode, WorkflowDefaults } from "@journeyman/core";
import { applyWorkflowDefaults } from "./apply-flow-defaults.ts";

const node = (extra: Partial<WorkflowNode> = {}): WorkflowNode =>
  ({ id: "n1", type: "step", stepType: "clone-repos", ...extra }) as WorkflowNode;

describe("applyWorkflowDefaults — workerId propagation", () => {
  it("propagates defaults.workerId when the node has none", () => {
    const { resolved } = applyWorkflowDefaults(node(), { workerId: "docker-w" } as WorkflowDefaults);
    expect(resolved.workerId).toBe("docker-w");
  });

  it("node.workerId overrides defaults.workerId", () => {
    const { resolved } = applyWorkflowDefaults(
      node({ workerId: "node-w" }),
      { workerId: "docker-w" } as WorkflowDefaults,
    );
    expect(resolved.workerId).toBe("node-w");
  });

  it("is undefined when neither node nor defaults set it", () => {
    const { resolved } = applyWorkflowDefaults(node(), {} as WorkflowDefaults);
    expect(resolved.workerId).toBeUndefined();
  });
});
