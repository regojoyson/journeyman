import { describe, it, expect, vi } from "vitest";
import { applyBuildPlan, type ApplyDeps } from "./apply.ts";
import type { BuildPlan, CreateWorkflowArgs } from "@journeyman/core";

function planWith(custom: BuildPlan["newCustomSteps"], graph: BuildPlan["workflow"]): BuildPlan {
  return { newCustomSteps: custom, workflow: graph, defaults: { sandboxId: null, model: null }, stepBindings: [], gaps: [], summary: "s" };
}

const baseArgs = { workflowName: "PR review", createdBy: "u1", workspaceId: "w1" };

describe("applyBuildPlan", () => {
  it("creates steps, rewrites ids, and creates a draft workflow", async () => {
    const insertStep = vi.fn(async (input: any) => ({ id: `real-${input.name}` }));
    const createWorkflow = vi.fn(async (_args: CreateWorkflowArgs) => ({ workflowId: "wf-1" }));
    const deleteStep = vi.fn(async () => {});
    const deps: ApplyDeps = { insertStep, deleteStep, createWorkflow };

    const plan = planWith(
      [{ id: "tmp-a", step: { name: "Review" } }],
      { schemaVersion: 2, nodes: [
        { id: "n_1", type: "step", stepType: "custom-ai", config: { customStepId: "tmp-a" }, position: { x: 0, y: 0 } },
      ], edges: [] },
    );

    const res = await applyBuildPlan(deps, { ...baseArgs, plan });

    expect(insertStep).toHaveBeenCalledTimes(1);
    expect(insertStep.mock.calls[0][0]).toMatchObject({ name: "Review", workspaceId: "w1", createdBy: "u1" });
    const passedGraph = (createWorkflow.mock.calls[0][0] as CreateWorkflowArgs).initialDefinition;
    expect(passedGraph.nodes[0].config!.customStepId).toBe("real-Review");
    expect(createWorkflow.mock.calls[0][0]).toMatchObject({ workspaceId: "w1", name: "PR review" });
    expect(res).toEqual({ workflowId: "wf-1", createdStepIds: ["real-Review"], placeholderToRealId: { "tmp-a": "real-Review" } });
    expect(deleteStep).not.toHaveBeenCalled();
  });

  it("rolls back created steps when workflow creation fails", async () => {
    const insertStep = vi.fn(async (input: any) => ({ id: `real-${input.name}` }));
    const createWorkflow = vi.fn(async (_args: CreateWorkflowArgs) => { throw new Error("boom"); });
    const deleteStep = vi.fn(async (_id: string) => {});
    const deps: ApplyDeps = { insertStep, deleteStep, createWorkflow };

    const plan = planWith(
      [{ id: "tmp-a", step: { name: "A" } }, { id: "tmp-b", step: { name: "B" } }],
      { schemaVersion: 2, nodes: [], edges: [] },
    );

    await expect(applyBuildPlan(deps, { ...baseArgs, plan })).rejects.toThrow("boom");
    expect(deleteStep.mock.calls.map((c) => c[0])).toEqual(["real-B", "real-A"]);
  });

  it("creates a workspace-scoped workflow", async () => {
    const insertStep = vi.fn(async (_input: any) => ({ id: "real-x" }));
    const createWorkflow = vi.fn(async (_args: CreateWorkflowArgs) => ({ workflowId: "wf" }));
    const deps: ApplyDeps = { insertStep, deleteStep: vi.fn(async (_id: string) => {}), createWorkflow };

    const plan = planWith(
      [{ id: "tmp-a", step: { name: "Shared" } }],
      { schemaVersion: 2, nodes: [], edges: [] },
    );
    await applyBuildPlan(deps, { workflowName: "w", createdBy: "u1", workspaceId: "w1", plan });

    expect(insertStep.mock.calls[0][0]).toMatchObject({ workspaceId: "w1", createdBy: "u1" });
    expect(createWorkflow.mock.calls[0][0]).toMatchObject({ workspaceId: "w1", name: "w" });
  });

  it("creates the workflow directly when there are no new steps", async () => {
    const insertStep = vi.fn();
    const createWorkflow = vi.fn(async () => ({ workflowId: "wf" }));
    const deps: ApplyDeps = { insertStep, deleteStep: vi.fn(), createWorkflow };
    const plan = planWith([], { schemaVersion: 2, nodes: [], edges: [] });
    const res = await applyBuildPlan(deps, { ...baseArgs, plan });
    expect(insertStep).not.toHaveBeenCalled();
    expect(res.createdStepIds).toEqual([]);
    expect(res.workflowId).toBe("wf");
  });
});
