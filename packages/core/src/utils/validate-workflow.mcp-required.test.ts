import { describe, it, expect } from "vitest";
import { validateWorkflowInputs, type ValidationCatalog } from "./validate-workflow.ts";
import type { WorkflowGraph } from "../types/flow.types.ts";

function flowWithCustomAi(mcpInstanceIds: string[]): WorkflowGraph {
  return {
    schemaVersion: "v1",
    nodes: [
      { id: "start", type: "start", displayName: "Start", config: {}, position: { x: 0, y: 0 } },
      {
        id: "n1",
        type: "step",
        stepType: "custom-ai",
        displayName: "Linear Step",
        config: { customStepId: "cp-1", mcpInstanceIds },
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
      "cp-1": {
        name: "Linear Step",
        requiresSkills: false,
        defaultSkillIds: [],
        requiresMcp: true,
        defaultMcpIds: ["linear-mcp"],
      },
    },
  },
};

describe("validateWorkflowInputs — requiresMcp", () => {
  it("emits missing-required when requiresMcp is true and mcpInstanceIds is empty", () => {
    const warnings = validateWorkflowInputs(flowWithCustomAi([]), catalog);
    const w = warnings.find(w => w.code === "missing-required" && w.nodeId === "n1" && w.inputKey === "mcpInstanceIds");
    expect(w).toBeDefined();
    expect(w!.message).toContain("Linear Step");
    expect(w!.message).toContain("requires at least one MCP");
    expect(w!.message).toContain("linear-mcp");
  });

  it("passes when mcpInstanceIds has at least one entry", () => {
    const warnings = validateWorkflowInputs(flowWithCustomAi(["any-mcp"]), catalog);
    expect(warnings.find(w => "inputKey" in w && w.inputKey === "mcpInstanceIds")).toBeUndefined();
  });

  it("passes when requiresMcp is false even if mcpInstanceIds is empty", () => {
    const customCatalog: ValidationCatalog = {
      "custom-ai": {
        inputFields: {},
        outputSchema: null,
        customSteps: {
          "cp-1": {
            name: "Linear Step",
            requiresSkills: false,
            defaultSkillIds: [],
            requiresMcp: false,
            defaultMcpIds: [],
          },
        },
      },
    };
    const warnings = validateWorkflowInputs(flowWithCustomAi([]), customCatalog);
    expect(warnings.find(w => "inputKey" in w && w.inputKey === "mcpInstanceIds")).toBeUndefined();
  });

  it("omits suggested clause when defaultMcpIds is empty", () => {
    const customCatalog: ValidationCatalog = {
      "custom-ai": {
        inputFields: {},
        outputSchema: null,
        customSteps: {
          "cp-1": {
            name: "Linear Step",
            requiresSkills: false,
            defaultSkillIds: [],
            requiresMcp: true,
            defaultMcpIds: [],
          },
        },
      },
    };
    const warnings = validateWorkflowInputs(flowWithCustomAi([]), customCatalog);
    const w = warnings.find(w => "inputKey" in w && w.inputKey === "mcpInstanceIds");
    expect(w).toBeDefined();
    expect(w!.message).not.toContain("Suggested:");
  });
});
