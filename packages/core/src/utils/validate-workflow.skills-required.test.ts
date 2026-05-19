import { describe, it, expect } from "vitest";
import { validateWorkflowInputs, type ValidationCatalog } from "./validate-workflow.ts";
import type { WorkflowGraph } from "../types/flow.types.ts";

function flowWithCustomAi(skillPackageIds: string[]): WorkflowGraph {
  return {
    schemaVersion: "v1",
    nodes: [
      { id: "start", type: "start", displayName: "Start", config: {}, position: { x: 0, y: 0 } },
      {
        id: "n1",
        type: "step",
        stepType: "custom-ai",
        displayName: "Code Review",
        config: { customStepId: "cp-1", skillPackageIds },
        position: { x: 100, y: 0 },
      },
      { id: "end", type: "end", displayName: "End", config: {}, position: { x: 200, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "n1", type: "default" },
      { id: "e2", source: "n1", target: "end", type: "default" },
    ],
  } as unknown as WorkflowGraph;
}

const catalog: ValidationCatalog = {
  "custom-ai": {
    inputFields: {},
    outputSchema: null,
    customSteps: {
      "cp-1": { name: "Code Review", requiresSkills: true, defaultSkillIds: ["code-reviewer"], requiresMcp: false, defaultMcpIds: [] },
    },
  },
};

describe("validateWorkflowInputs — requiresSkills", () => {
  it("emits missing-required when requiresSkills is true and skillPackageIds is empty", () => {
    const warnings = validateWorkflowInputs(flowWithCustomAi([]), catalog);
    const w = warnings.find(w => w.code === "missing-required" && w.nodeId === "n1" && w.inputKey === "skillPackageIds");
    expect(w).toBeDefined();
    expect(w!.message).toContain("Code Review");
    expect(w!.message).toContain("requires at least one skill");
    expect(w!.message).toContain("code-reviewer");
  });

  it("passes when skillPackageIds has at least one entry", () => {
    const warnings = validateWorkflowInputs(flowWithCustomAi(["any-skill"]), catalog);
    expect(warnings.find(w => "nodeId" in w && w.nodeId === "n1" && "inputKey" in w && w.inputKey === "skillPackageIds")).toBeUndefined();
  });

  it("passes when requiresSkills is false even if skillPackageIds is empty", () => {
    const customCatalog: ValidationCatalog = {
      "custom-ai": {
        inputFields: {},
        outputSchema: null,
        customSteps: { "cp-1": { name: "Code Review", requiresSkills: false, defaultSkillIds: [], requiresMcp: false, defaultMcpIds: [] } },
      },
    };
    const warnings = validateWorkflowInputs(flowWithCustomAi([]), customCatalog);
    expect(warnings.find(w => "nodeId" in w && w.nodeId === "n1" && "inputKey" in w && w.inputKey === "skillPackageIds")).toBeUndefined();
  });

  it("does not crash when step def is missing from catalog", () => {
    const customCatalog: ValidationCatalog = {
      "custom-ai": { inputFields: {}, outputSchema: null, customSteps: {} },
    };
    const warnings = validateWorkflowInputs(flowWithCustomAi([]), customCatalog);
    expect(warnings.find(w => "nodeId" in w && w.nodeId === "n1" && "inputKey" in w && w.inputKey === "skillPackageIds")).toBeUndefined();
  });
});
