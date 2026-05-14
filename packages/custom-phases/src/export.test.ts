import { describe, it, expect } from "vitest";
import type { CustomAiPhase } from "@journeyman/core";
import {
  CUSTOM_PHASE_EXPORT_KIND,
  CUSTOM_PHASE_EXPORT_VERSION,
} from "@journeyman/core";
import { toExportV1 } from "./export.ts";

const samplePhase: CustomAiPhase = {
  id: "phase-123",
  scope: "user",
  userId: "user-1",
  orgId: "org-1",
  name: "Analyze Repo",
  description: "Look at the repo",
  icon: "lucide:Sparkles",
  inputFields: [{ name: "repoUrl", type: "string", required: true }],
  outputMode: "structured",
  outputSchema: { type: "object" },
  promptTemplate: "Analyze {{repoUrl}}",
  defaultTools: ["Bash"],
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
    const out = toExportV1(samplePhase);

    expect(out.schemaVersion).toBe(CUSTOM_PHASE_EXPORT_VERSION);
    expect(out.kind).toBe(CUSTOM_PHASE_EXPORT_KIND);
    expect(typeof out.exportedAt).toBe("string");
    expect(out.exportedFrom).toBe("journeyman");

    expect(out.phase).not.toHaveProperty("id");
    expect(out.phase).not.toHaveProperty("scope");
    expect(out.phase).not.toHaveProperty("userId");
    expect(out.phase).not.toHaveProperty("orgId");
    expect(out.phase).not.toHaveProperty("createdBy");
    expect(out.phase).not.toHaveProperty("createdAt");
    expect(out.phase).not.toHaveProperty("updatedAt");

    expect(out.phase.defaultMcpIds).toEqual([]);
    expect(out.phase.defaultSkillIds).toEqual([]);

    expect(out.phase.name).toBe("Analyze Repo");
    expect(out.phase.description).toBe("Look at the repo");
    expect(out.phase.icon).toBe("lucide:Sparkles");
    expect(out.phase.outputMode).toBe("structured");
    expect(out.phase.outputSchema).toEqual({ type: "object" });
    expect(out.phase.promptTemplate).toBe("Analyze {{repoUrl}}");
    expect(out.phase.defaultTools).toEqual(["Bash"]);
    expect(out.phase.requiresSkills).toBe(false);
    expect(out.phase.requiresMcp).toBe(false);
    expect(out.phase.slots).toEqual([{ name: "GITHUB_TOKEN", description: "GH PAT" }]);
    expect(out.phase.inputFields).toEqual([
      { name: "repoUrl", type: "string", required: true },
    ]);
  });

  it("defaults missing optional fields safely", () => {
    const minimal: CustomAiPhase = {
      ...samplePhase,
      icon: undefined,
      outputSchema: undefined,
    };
    const out = toExportV1(minimal);
    expect(out.phase.icon).toBeNull();
    expect(out.phase.outputSchema).toBeUndefined();
  });
});
