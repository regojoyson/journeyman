import { describe, it, expect } from "vitest";
import { rowToAgent, buildInsert } from "./db.ts";

describe("rowToAgent", () => {
  it("merges columns with the definition JSONB", () => {
    const row = {
      id: "a1",
      scope: "org",
      user_id: null,
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
    expect(a.name).toBe("Triage");
    expect(a.status).toBe("draft");
    expect(a.provider).toBe("claude");
    expect(a.tools).toEqual(["bash"]);
    expect(a.userId).toBeUndefined();
  });
});

describe("buildInsert", () => {
  it("splits name/status/enabled out of the definition", () => {
    const { cols, vals, def } = buildInsert({
      scope: "org",
      orgId: "o1",
      userId: null,
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
