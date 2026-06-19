import { describe, it, expect } from "vitest";
import type { Agent } from "@journeyman/core";
import { buildUpdateInput, isAgentDirty, agentSummary, statusLabel } from "./agent-form.ts";

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
      repoSelections: [{ repo: "acme/api", allowWrites: false }],
      triggers: [{ type: "schedule", cron: "0 2 * * *", timezone: "UTC" }],
      behavior: {},
      outputMode: "text",
      limits: undefined,
      permissions: { allowedTools: [] },
      tools: [],
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
