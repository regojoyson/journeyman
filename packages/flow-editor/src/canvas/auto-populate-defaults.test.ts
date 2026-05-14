import { describe, it, expect } from "vitest";
import { autoPopulateCustomAiDefaults } from "./auto-populate-defaults.ts";
import type { WorkflowNode, CustomAiPhase } from "@journeyman/core";

function node(config: Record<string, unknown>): WorkflowNode {
  return {
    id: "n1",
    type: "phase",
    phaseType: "custom-ai",
    displayName: "x",
    config,
    position: { x: 0, y: 0 },
  } as unknown as WorkflowNode;
}

function def(overrides: Partial<CustomAiPhase>): CustomAiPhase {
  return {
    id: "cp",
    scope: "user",
    orgId: "o",
    name: "Phase",
    description: "",
    inputFields: [],
    outputMode: "none",
    promptTemplate: "",
    defaultTools: [],
    defaultMcpIds: [],
    defaultSkillIds: [],
    slots: [],
    requiresSkills: false,
    requiresMcp: false,
    createdBy: "u",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("autoPopulateCustomAiDefaults", () => {
  it("copies defaultSkillIds into a new custom-ai node with no skills", () => {
    const out = autoPopulateCustomAiDefaults(
      node({ customPhaseId: "cp" }),
      def({ defaultSkillIds: ["a", "b"] }),
    );
    expect((out.config as { skillPackageIds?: string[] }).skillPackageIds).toEqual(["a", "b"]);
  });

  it("does not override existing non-empty skillPackageIds", () => {
    const out = autoPopulateCustomAiDefaults(
      node({ customPhaseId: "cp", skillPackageIds: ["preset"] }),
      def({ defaultSkillIds: ["a"] }),
    );
    expect((out.config as { skillPackageIds?: string[] }).skillPackageIds).toEqual(["preset"]);
  });

  it("leaves skillPackageIds empty when defaultSkillIds is empty", () => {
    const out = autoPopulateCustomAiDefaults(node({ customPhaseId: "cp" }), def({ defaultSkillIds: [] }));
    expect((out.config as { skillPackageIds?: string[] }).skillPackageIds ?? []).toEqual([]);
  });

  it("returns node unchanged when def is null", () => {
    const n = node({ customPhaseId: "cp" });
    expect(autoPopulateCustomAiDefaults(n, null)).toBe(n);
  });

  it("returns node unchanged for non-custom-ai phase types", () => {
    const n = { ...node({}), phaseType: "analyze" } as WorkflowNode;
    expect(autoPopulateCustomAiDefaults(n, def({ defaultSkillIds: ["a"] }))).toBe(n);
  });
});
