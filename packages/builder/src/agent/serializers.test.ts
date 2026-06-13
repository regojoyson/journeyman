import { describe, it, expect } from "vitest";
import {
  serializeStepCatalog, serializeProviders, serializeNodeTypes, serializeInventory,
} from "./serializers.ts";

describe("serializeStepCatalog", () => {
  it("lists each step with its inputs and outputs", () => {
    const out = serializeStepCatalog([
      { stepType: "get-issue", label: "Get Issue", category: "Issue Tracker", inputs: ["ref"], outputs: ["issue"] },
      { stepType: "custom-ai", label: "Custom AI Step", category: "Custom", inputs: [], outputs: [] },
    ]);
    expect(out).toContain("get-issue");
    expect(out).toContain("Get Issue");
    expect(out).toContain("ref");
    expect(out).toContain("issue");
    expect(out).toContain("custom-ai");
  });
});

describe("serializeProviders", () => {
  it("groups implemented providers by kind", () => {
    const out = serializeProviders([
      { kind: "git-provider", value: "github", label: "GitHub" },
      { kind: "issue-provider", value: "jira", label: "Jira" },
    ]);
    expect(out).toContain("git-provider");
    expect(out).toContain("github");
    expect(out).toContain("jira");
  });
});

describe("serializeNodeTypes", () => {
  it("lists the supported node types", () => {
    expect(serializeNodeTypes(["step", "gateway-xor", "human-task"])).toContain("gateway-xor");
  });
});

describe("serializeInventory", () => {
  it("renders each inventory category, and says 'none' for empty ones", () => {
    const out = serializeInventory({
      customSteps: [{ id: "c1", name: "Security review", description: "Reviews diffs" }],
      mcps: [],
      skills: [{ id: "s1", name: "secure-coding" }],
      sandboxes: [{ id: "sb1", name: "docker-default", type: "docker", tags: ["node"] }],
      webhooks: [{ id: "w1", name: "gh", preset: "github" }],
    });
    expect(out).toContain("Security review");
    expect(out).toContain("secure-coding");
    expect(out).toContain("docker-default");
    expect(out).toContain("gh");
    expect(out.toLowerCase()).toContain("none");
  });
});
