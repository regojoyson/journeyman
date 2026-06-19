import { describe, it, expect } from "vitest";
import { checkReadiness } from "./readiness.ts";
import type { Agent } from "@journeyman/core";

const ok: Agent = {
  id: "a",
  workspaceId: "ws1",
  orgId: "o",
  name: "A",
  instructions: "do it",
  inputs: [],
  provider: "claude",
  model: "claude-opus-4-8",
  connectorMcpIds: [],
  tools: [],
  skillIds: [],
  repoSelections: [],
  permissions: { allowedTools: [] },
  notifications: { on: [] },
  outputMode: "text",
  behavior: {},
  triggers: [],
  status: "draft",
  enabled: false,
  createdBy: "u",
  createdAt: "",
  updatedAt: "",
};

describe("checkReadiness", () => {
  it("passes a minimal valid agent", () => {
    expect(checkReadiness(ok)).toEqual([]);
  });
  it("flags empty instructions and missing model", () => {
    const errs = checkReadiness({ ...ok, instructions: "  ", model: undefined });
    expect(errs.some((e) => e.field === "instructions")).toBe(true);
    expect(errs.some((e) => e.field === "model")).toBe(true);
  });
  it("requires a sandbox when workspace tools are used", () => {
    const errs = checkReadiness({ ...ok, tools: ["bash"], sandboxId: undefined });
    expect(errs.some((e) => e.field === "sandbox")).toBe(true);
  });
  it("flags a required input a schedule trigger cannot fill", () => {
    const errs = checkReadiness({
      ...ok,
      inputs: [{ name: "k", type: "text", required: true }],
      triggers: [{ type: "schedule", cron: "0 2 * * *", timezone: "UTC" }],
    });
    expect(errs.some((e) => e.field === "inputs")).toBe(true);
  });
});
