import { describe, it, expect } from "vitest";
import type { Agent } from "@journeyman/core";
import { buildUpdateInput, isAgentDirty, agentSummary, statusLabel, isSectionDirty, buildSectionUpdateInput } from "./agent-form.ts";

const base: Agent = {
  id: "a1",
  workspaceId: "w1",
  orgId: "o1",
  name: "triager",
  instructions: "do the thing",
  inputs: [],
  provider: "claude",
  model: "claude-opus-4-8",
  connectorMcpIds: [],
  tools: [],
  skillIds: [],
  repoSelections: [{ repo: "acme/api", allowWrites: false }],
  permissions: { allowedTools: [] },
  notifications: { on: [] },
  outputMode: "text",
  behavior: {},
  triggers: [{ type: "schedule", cron: "0 2 * * *", timezone: "UTC" }],
  status: "draft",
  enabled: false,
  createdBy: "u1",
  createdAt: "2026-06-19T00:00:00Z",
  updatedAt: "2026-06-19T00:00:00Z",
};

describe("buildUpdateInput", () => {
  it("includes only the editable fields", () => {
    const out = buildUpdateInput(base);
    expect(out).toEqual({
      instructions: "do the thing",
      inputs: [],
      provider: "claude",
      model: "claude-opus-4-8",
      sandboxId: undefined,
      repoSelections: [{ repo: "acme/api", allowWrites: false }],
      triggers: [{ type: "schedule", cron: "0 2 * * *", timezone: "UTC" }],
      behavior: {},
      outputMode: "text",
      limits: undefined,
      permissions: { allowedTools: [] },
      tools: [],
      connectorMcpIds: [],
      skillIds: [],
      notifications: { on: [] },
    });
    expect(out).not.toHaveProperty("id");
    expect(out).not.toHaveProperty("status");
  });
});

describe("isAgentDirty", () => {
  it("is false for an unchanged copy", () => {
    expect(isAgentDirty(base, base)).toBe(false);
  });
  it("is true when an editable field changes", () => {
    expect(isAgentDirty(base, { ...base, instructions: "changed" })).toBe(true);
  });
  it("ignores non-editable fields like updatedAt", () => {
    expect(isAgentDirty(base, { ...base, updatedAt: "2099-01-01T00:00:00Z" })).toBe(false);
  });
});

describe("agentSummary", () => {
  it("summarises provider and repo count", () => {
    expect(agentSummary(base)).toBe("claude · 1 repository");
    expect(agentSummary({ ...base, repoSelections: [] })).toBe("claude · 0 repositories");
  });
});

describe("statusLabel", () => {
  it("shows ENABLED when enabled regardless of status", () => {
    expect(statusLabel({ ...base, enabled: true })).toBe("ENABLED");
  });
  it("shows the uppercased status when disabled", () => {
    expect(statusLabel(base)).toBe("DRAFT");
  });
});

describe("isSectionDirty", () => {
  it("returns false when no fields in the section have changed", () => {
    expect(isSectionDirty(base, base, "instructions")).toBe(false);
  });

  it("returns true when an owned field changes", () => {
    const edited = { ...base, instructions: "Do something else" };
    expect(isSectionDirty(base, edited, "instructions")).toBe(true);
  });

  it("returns false for a different section even when its fields changed", () => {
    const edited = { ...base, instructions: "Do something else" };
    expect(isSectionDirty(base, edited, "workspace")).toBe(false);
  });

  it("returns true for workspace when model changes", () => {
    const edited = { ...base, model: "claude-opus-4-5" };
    expect(isSectionDirty(base, edited, "workspace")).toBe(true);
  });

  it("returns false for non-saveable sections (runs, delete)", () => {
    expect(isSectionDirty(base, { ...base, instructions: "changed" }, "runs")).toBe(false);
  });

  it("detects deep changes in triggers array", () => {
    const edited = { ...base, triggers: [{ type: "api" as const }] };
    expect(isSectionDirty(base, edited, "triggers")).toBe(true);
  });
});

describe("buildSectionUpdateInput", () => {
  it("returns only the fields owned by the instructions section", () => {
    const result = buildSectionUpdateInput(base, "instructions");
    expect(Object.keys(result).sort()).toEqual(["inputs", "instructions"]);
    expect(result.instructions).toBe("do the thing");
    expect(result.inputs).toEqual([]);
  });

  it("returns only the fields owned by the workspace section", () => {
    const result = buildSectionUpdateInput(base, "workspace");
    expect(Object.keys(result).sort()).toEqual(["model", "provider", "repoSelections", "sandboxId"]);
  });

  it("returns only the fields owned by the permissions section", () => {
    const result = buildSectionUpdateInput(base, "permissions");
    expect(Object.keys(result).sort()).toEqual(["permissions", "tools"]);
  });

  it("returns only the fields owned by the integrations section", () => {
    const result = buildSectionUpdateInput(base, "integrations");
    expect(Object.keys(result).sort()).toEqual(["connectorMcpIds", "skillIds"]);
    expect(result.connectorMcpIds).toEqual([]);
    expect(result.skillIds).toEqual([]);
  });

  it("returns an empty object for non-saveable sections", () => {
    expect(buildSectionUpdateInput(base, "runs")).toEqual({});
  });
});
