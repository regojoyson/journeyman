import { describe, it, expect } from "vitest";
import { rowToAgent, buildInsert } from "./db.ts";

describe("rowToAgent", () => {
  it("merges columns with the definition JSONB", () => {
    const row = {
      id: "a1",
      workspace_id: "ws1",
      org_id: "o1",
      name: "Triage",
      status: "draft",
      enabled: false,
      definition: {
        instructions: "do {{x}}",
        provider: "claude",
        tools: ["bash"],
        inputs: [],
        repoSelections: [],
        skillIds: [],
        connectorMcpIds: [],
        permissions: { allowedTools: [] },
        notifications: { on: [] },
        behavior: {},
        triggers: [],
        outputMode: "text",
      },
      created_by: "u1",
      created_at: "2026-06-18T00:00:00Z",
      updated_at: "2026-06-18T00:00:00Z",
    };
    const a = rowToAgent(row);
    expect(a.id).toBe("a1");
    expect(a.workspaceId).toBe("ws1");
    expect(a.name).toBe("Triage");
    expect(a.status).toBe("draft");
    expect(a.provider).toBe("claude");
    expect(a.tools).toEqual(["bash"]);
  });

  it("reads agentLogLevel back from the definition JSONB", () => {
    const row = {
      id: "a2",
      workspace_id: "ws1",
      org_id: "o1",
      name: "Logged",
      status: "draft",
      enabled: false,
      definition: { provider: "claude", agentLogLevel: "all" },
      created_by: "u1",
      created_at: "2026-06-18T00:00:00Z",
      updated_at: "2026-06-18T00:00:00Z",
    };
    expect(rowToAgent(row).agentLogLevel).toBe("all");
  });
});

describe("buildInsert", () => {
  it("splits name/status/enabled out of the definition", () => {
    const { cols, vals, def } = buildInsert({
      workspaceId: "ws1",
      orgId: "o1",
      createdBy: "u1",
      name: "Triage",
      status: "draft",
      enabled: false,
      instructions: "hi",
      provider: "claude",
      inputs: [],
      tools: [],
      connectorMcpIds: [],
      skillIds: [],
      repoSelections: [],
      permissions: { allowedTools: [] },
      notifications: { on: [] },
      behavior: {},
      triggers: [],
      outputMode: "text",
    } as any);
    expect(cols).toContain("name");
    expect(cols).toContain("definition");
    expect(vals).toContain("Triage");
    expect((def as any).instructions).toBe("hi");
    expect((def as any).name).toBeUndefined(); // name lives in its column, not the doc
  });
});
