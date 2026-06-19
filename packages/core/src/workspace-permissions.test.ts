import { describe, it, expect } from "vitest";
import { WORKSPACE_PERMISSIONS } from "./types/workspace.types.ts";
import { roleGrants, resolvePermissions, evaluateCan } from "./workspace-permissions.ts";

describe("roleGrants", () => {
  it("observer can view + read only", () => {
    expect([...roleGrants("observer")].sort()).toEqual(["resource.read", "workspace.view"]);
  });
  it("contributor adds write + delete", () => {
    const g = roleGrants("contributor");
    expect(g.has("resource.write")).toBe(true);
    expect(g.has("resource.delete")).toBe(true);
    expect(g.has("members.manage")).toBe(false);
  });
  it("maintainer has every permission", () => {
    const g = roleGrants("maintainer");
    for (const p of WORKSPACE_PERMISSIONS) expect(g.has(p)).toBe(true);
  });
});

describe("resolvePermissions", () => {
  it("returns the role grant set (ignores reserved permissions slot in phase 1)", () => {
    expect([...resolvePermissions({ role: "observer", permissions: ["settings.manage"] })].sort())
      .toEqual(["resource.read", "workspace.view"]);
  });
});

describe("evaluateCan", () => {
  it("platform admin can do anything, even with no membership", () => {
    expect(evaluateCan({ isPlatformAdmin: true, isOrgAdmin: false, member: null }, "settings.manage")).toBe(true);
  });
  it("org admin can do anything (implicit maintainer)", () => {
    expect(evaluateCan({ isPlatformAdmin: false, isOrgAdmin: true, member: null }, "members.manage")).toBe(true);
  });
  it("observer cannot write", () => {
    expect(evaluateCan({ isPlatformAdmin: false, isOrgAdmin: false, member: { role: "observer" } }, "resource.write")).toBe(false);
  });
  it("contributor can write but not manage members", () => {
    const m = { role: "contributor" as const };
    expect(evaluateCan({ isPlatformAdmin: false, isOrgAdmin: false, member: m }, "resource.write")).toBe(true);
    expect(evaluateCan({ isPlatformAdmin: false, isOrgAdmin: false, member: m }, "members.manage")).toBe(false);
  });
  it("no access when not a member and not admin", () => {
    expect(evaluateCan({ isPlatformAdmin: false, isOrgAdmin: false, member: null }, "resource.read")).toBe(false);
  });
});
