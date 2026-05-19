import { describe, it, expect } from "vitest";
import { assertScopeSafeDefaults, ScopeViolationError } from "./scope-guard.ts";

const lookup = {
  skill: async (id: string) => {
    if (id === "user-skill") return { scope: "user" as const };
    if (id === "org-skill") return { scope: "org" as const };
    if (id === "global-skill") return { scope: "global" as const };
    return null;
  },
  mcp: async (id: string) => {
    if (id === "user-mcp") return { scope: "user" as const };
    if (id === "org-mcp") return { scope: "org" as const };
    return null;
  },
};

describe("assertScopeSafeDefaults", () => {
  it("allows user step to reference user/org/global resources", async () => {
    await expect(assertScopeSafeDefaults({
      stepScope: "user",
      defaultSkillIds: ["user-skill", "org-skill", "global-skill"],
      defaultMcpIds: ["user-mcp", "org-mcp"],
      lookup,
    })).resolves.toBeUndefined();
  });

  it("rejects org step referencing a user-scoped skill", async () => {
    await expect(assertScopeSafeDefaults({
      stepScope: "org",
      defaultSkillIds: ["user-skill"],
      defaultMcpIds: [],
      lookup,
    })).rejects.toBeInstanceOf(ScopeViolationError);
  });

  it("error lists every offending entry", async () => {
    try {
      await assertScopeSafeDefaults({
        stepScope: "org",
        defaultSkillIds: ["user-skill", "org-skill"],
        defaultMcpIds: ["user-mcp"],
        lookup,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ScopeViolationError);
      const e = err as ScopeViolationError;
      expect(e.offenders).toEqual([
        { kind: "skill", id: "user-skill", scope: "user" },
        { kind: "mcp",   id: "user-mcp",   scope: "user" },
      ]);
    }
  });

  it("rejects unknown skill IDs as offenders", async () => {
    await expect(assertScopeSafeDefaults({
      stepScope: "org",
      defaultSkillIds: ["does-not-exist"],
      defaultMcpIds: [],
      lookup,
    })).rejects.toBeInstanceOf(ScopeViolationError);
  });
});
