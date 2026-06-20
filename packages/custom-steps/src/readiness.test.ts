import { describe, it, expect } from "vitest";
import { checkCustomStepReadiness } from "./readiness.ts";
import type { CustomAiStep } from "@journeyman/core";

const ok: CustomAiStep = {
  id: "s1",
  workspaceId: "ws1",
  name: "My Step",
  description: "",
  icon: null,
  enabled: false,
  inputFields: [],
  outputMode: "none",
  outputFields: [],
  promptTemplate: "Do the thing.",
  defaultTools: [],
  defaultMcpIds: [],
  defaultSkillIds: [],
  requiresSkills: false,
  requiresMcp: false,
  slots: [],
  createdBy: "u1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("checkCustomStepReadiness", () => {
  it("passes a valid step", () => {
    expect(checkCustomStepReadiness(ok)).toEqual([]);
  });

  it("flags empty name", () => {
    const errs = checkCustomStepReadiness({ ...ok, name: "   " });
    expect(errs.some((e) => e.field === "name")).toBe(true);
  });

  it("flags empty promptTemplate", () => {
    const errs = checkCustomStepReadiness({ ...ok, promptTemplate: "" });
    expect(errs.some((e) => e.field === "promptTemplate")).toBe(true);
  });

  it("flags both when both are empty", () => {
    const errs = checkCustomStepReadiness({ ...ok, name: "", promptTemplate: "  " });
    expect(errs).toHaveLength(2);
  });
});
