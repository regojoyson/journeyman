import { describe, it, expect } from "vitest";
import type { WorkflowNode, WorkflowDefaults } from "@journeyman/core";
import { applyWorkflowDefaults } from "./apply-flow-defaults.ts";

const node = (extra: Partial<WorkflowNode> = {}): WorkflowNode =>
  ({ id: "n1", type: "step", stepType: "clone-repos", ...extra }) as WorkflowNode;

describe("applyWorkflowDefaults — computeTargetId propagation", () => {
  it("propagates defaults.computeTargetId when the node has none", () => {
    const { resolved, sources } = applyWorkflowDefaults(node(), { computeTargetId: "docker-w" } as WorkflowDefaults);
    expect(resolved.computeTargetId).toBe("docker-w");
    expect(sources["computeTargetId"]).toBe("workflow-default");
  });

  it("node.computeTargetId overrides defaults.computeTargetId", () => {
    const { resolved, sources } = applyWorkflowDefaults(
      node({ computeTargetId: "node-w" }),
      { computeTargetId: "docker-w" } as WorkflowDefaults,
    );
    expect(resolved.computeTargetId).toBe("node-w");
    expect(sources["computeTargetId"]).toBe("node");
  });

  it("is undefined when neither node nor defaults set it", () => {
    const { resolved } = applyWorkflowDefaults(node(), {} as WorkflowDefaults);
    expect(resolved.computeTargetId).toBeUndefined();
  });
});

describe("applyWorkflowDefaults — legacy workerId backward-compat", () => {
  it("treats a legacy node.workerId as computeTargetId (node source)", () => {
    const { resolved, sources } = applyWorkflowDefaults(
      node({ workerId: "ct-legacy" } as Partial<WorkflowNode>),
      {} as WorkflowDefaults,
    );
    expect(resolved.computeTargetId).toBe("ct-legacy");
    expect(sources["computeTargetId"]).toBe("node");
  });

  it("treats a legacy defaults.workerId as computeTargetId (workflow-default source)", () => {
    const { resolved, sources } = applyWorkflowDefaults(
      node(),
      { workerId: "ct-default" } as WorkflowDefaults,
    );
    expect(resolved.computeTargetId).toBe("ct-default");
    expect(sources["computeTargetId"]).toBe("workflow-default");
  });

  it("prefers the new computeTargetId over the legacy workerId", () => {
    const { resolved } = applyWorkflowDefaults(
      node({ computeTargetId: "ct-new", workerId: "ct-old" } as Partial<WorkflowNode>),
      {} as WorkflowDefaults,
    );
    expect(resolved.computeTargetId).toBe("ct-new");
  });
});
