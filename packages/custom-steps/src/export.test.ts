import { describe, it, expect } from "vitest";
import type { CustomAiStep } from "@journeyman/core";
import {
  CUSTOM_STEP_EXPORT_KIND,
  CUSTOM_STEP_EXPORT_VERSION,
} from "@journeyman/core";
import { CustomStepImportError, fromExportV1, toExportV1 } from "./export.ts";

const sampleStep: CustomAiStep = {
  id: "step-123",
  workspaceId: "ws-1",
  name: "Analyze Repo",
  description: "Look at the repo",
  icon: "lucide:Sparkles",
  enabled: false,
  inputFields: [{ name: "repoUrl", type: "string", required: true }],
  outputMode: "structured",
  outputFields: [{ name: "summary", type: "json-object", required: true }],
  promptTemplate: "Analyze {{repoUrl}}",
  defaultTools: ["bash"],
  defaultMcpIds: ["mcp-abc"],
  defaultSkillIds: ["skill-xyz"],
  requiresSkills: false,
  requiresMcp: false,
  slots: [{ name: "GITHUB_TOKEN", description: "GH PAT" }],
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
};

describe("toExportV1", () => {
  it("produces a v1 envelope with stripped reference + audit fields", () => {
    const out = toExportV1(sampleStep);

    expect(out.schemaVersion).toBe(CUSTOM_STEP_EXPORT_VERSION);
    expect(out.kind).toBe(CUSTOM_STEP_EXPORT_KIND);
    expect(typeof out.exportedAt).toBe("string");
    expect(out.exportedFrom).toBe("journeyman");

    expect(out.step).not.toHaveProperty("id");
    expect(out.step).not.toHaveProperty("scope");
    expect(out.step).not.toHaveProperty("userId");
    expect(out.step).not.toHaveProperty("orgId");
    expect(out.step).not.toHaveProperty("createdBy");
    expect(out.step).not.toHaveProperty("createdAt");
    expect(out.step).not.toHaveProperty("updatedAt");

    expect(out.step.defaultMcpIds).toEqual([]);
    expect(out.step.defaultSkillIds).toEqual([]);

    expect(out.step.name).toBe("Analyze Repo");
    expect(out.step.description).toBe("Look at the repo");
    expect(out.step.icon).toBe("lucide:Sparkles");
    expect(out.step.outputMode).toBe("structured");
    expect(out.step.outputFields).toEqual([{ name: "summary", type: "json-object", required: true }]);
    expect(out.step.promptTemplate).toBe("Analyze {{repoUrl}}");
    expect(out.step.defaultTools).toEqual(["bash"]);
    expect(out.step.requiresSkills).toBe(false);
    expect(out.step.requiresMcp).toBe(false);
    expect(out.step.slots).toEqual([{ name: "GITHUB_TOKEN", description: "GH PAT" }]);
    expect(out.step.inputFields).toEqual([
      { name: "repoUrl", type: "string", required: true },
    ]);
  });

  it("defaults missing optional fields safely", () => {
    const minimal: CustomAiStep = {
      ...sampleStep,
      icon: undefined,
      outputFields: undefined,
    };
    const out = toExportV1(minimal);
    expect(out.step.icon).toBeNull();
    expect(out.step.outputFields).toEqual([]);
  });
});

describe("fromExportV1", () => {
  const validExport = {
    schemaVersion: 1,
    kind: "journeyman.customStep",
    exportedAt: "2026-01-01T00:00:00Z",
    exportedFrom: "journeyman",
    step: {
      name: "P",
      description: "d",
      icon: null,
      inputFields: [],
      outputMode: "text",
      promptTemplate: "go",
      defaultTools: [],
      defaultMcpIds: [],
      defaultSkillIds: [],
      requiresSkills: false,
      requiresMcp: false,
      slots: [],
    },
  };

  it("returns a CustomAiStepCreateInput-shaped object on a valid v1 export", () => {
    const out = fromExportV1(validExport);
    expect(out.name).toBe("P");
    expect(out.description).toBe("d");
    expect(out.outputMode).toBe("text");
    expect(out.promptTemplate).toBe("go");
    expect(out.defaultTools).toEqual([]);
    expect(out.defaultMcpIds).toEqual([]);
    expect(out.defaultSkillIds).toEqual([]);
    expect(out.slots).toEqual([]);
    expect(out.inputFields).toEqual([]);
    expect(out.icon).toBeNull();
    expect((out as unknown as Record<string, unknown>).scope).toBeUndefined();
  });

  it("strips defaultMcpIds / defaultSkillIds even if they were non-empty", () => {
    const tampered = {
      ...validExport,
      step: {
        ...validExport.step,
        defaultMcpIds: ["should-be-dropped"],
        defaultSkillIds: ["also-dropped"],
      },
    };
    const out = fromExportV1(tampered);
    expect(out.defaultMcpIds).toEqual([]);
    expect(out.defaultSkillIds).toEqual([]);
  });

  it("rejects a non-object body", () => {
    expect(() => fromExportV1(null)).toThrow(CustomStepImportError);
    expect(() => fromExportV1("nope")).toThrow(CustomStepImportError);
    expect(() => fromExportV1(42)).toThrow(CustomStepImportError);
  });

  it("rejects the wrong kind", () => {
    expect(() =>
      fromExportV1({ ...validExport, kind: "something-else" }),
    ).toThrow(/kind/);
  });

  it("rejects an unsupported schemaVersion", () => {
    expect(() =>
      fromExportV1({ ...validExport, schemaVersion: 2 }),
    ).toThrow(/schemaVersion/);
  });

  it("rejects a missing step object", () => {
    const { step: _drop, ...noStep } = validExport;
    expect(() => fromExportV1(noStep)).toThrow(/step/);
  });
});
