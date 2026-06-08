import { describe, it, expect } from "vitest";
import type { WorkflowNode, WorkflowDefaults } from "@journeyman/core";
import { applyWorkflowDefaults } from "./apply-flow-defaults.ts";

const node = (extra: Partial<WorkflowNode> = {}): WorkflowNode =>
  ({ id: "n1", type: "step", stepType: "clone-repos", ...extra }) as WorkflowNode;

describe("applyWorkflowDefaults — sandboxId propagation", () => {
  it("propagates defaults.sandboxId when the node has none", () => {
    const { resolved, sources } = applyWorkflowDefaults(node(), { sandboxId: "docker-w" } as WorkflowDefaults);
    expect(resolved.sandboxId).toBe("docker-w");
    expect(sources["sandboxId"]).toBe("workflow-default");
  });

  it("node.sandboxId overrides defaults.sandboxId", () => {
    const { resolved, sources } = applyWorkflowDefaults(
      node({ sandboxId: "node-w" }),
      { sandboxId: "docker-w" } as WorkflowDefaults,
    );
    expect(resolved.sandboxId).toBe("node-w");
    expect(sources["sandboxId"]).toBe("node");
  });

  it("is undefined when neither node nor defaults set it", () => {
    const { resolved } = applyWorkflowDefaults(node(), {} as WorkflowDefaults);
    expect(resolved.sandboxId).toBeUndefined();
  });
});
