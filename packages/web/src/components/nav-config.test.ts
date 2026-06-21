import { describe, it, expect } from "vitest";
import { NAV_GROUPS, filterGroups, navHref, initials } from "./nav-config.ts";

describe("NAV_GROUPS", () => {
  it("has the three groups in order", () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(["workspace", "integrations", "organization"]);
  });
  it("marks the organization group org-scoped and admin-only", () => {
    const org = NAV_GROUPS.find((g) => g.id === "organization")!;
    expect(org.scope).toBe("org");
    expect(org.adminOnly).toBe(true);
  });
  it("has no members item in the workspace group", () => {
    const ws = NAV_GROUPS.find((g) => g.id === "workspace")!;
    expect(ws.items.find((i) => i.slug === "members")).toBeUndefined();
  });
});

describe("filterGroups", () => {
  it("returns all groups unchanged for an empty query", () => {
    expect(filterGroups(NAV_GROUPS, "  ")).toEqual(NAV_GROUPS);
  });
  it("keeps only matching items and drops empty groups", () => {
    const result = filterGroups(NAV_GROUPS, "work");
    expect(result.map((g) => g.id)).toEqual(["workspace", "organization"]);
    expect(result[0].items.map((i) => i.slug)).toEqual(["workflows", "workflow-instances"]);
    expect(result[1].items.map((i) => i.slug)).toEqual(["workspaces"]);
  });
  it("is case-insensitive", () => {
    expect(filterGroups(NAV_GROUPS, "AGENTS")[0].items[0].slug).toBe("agents");
  });
});

describe("navHref", () => {
  it("builds workspace-scoped hrefs", () => {
    const ws = NAV_GROUPS[0];
    expect(navHref(ws, ws.items[0], "w1", "o1")).toBe("/workspaces/w1/dashboard");
  });
  it("builds org-scoped hrefs", () => {
    const org = NAV_GROUPS.find((g) => g.id === "organization")!;
    expect(navHref(org, org.items[0], "w1", "o1")).toBe("/orgs/o1/workspaces");
  });
});

describe("initials", () => {
  it("uses first+last initials for multi-word", () => {
    expect(initials("Samuel Rego")).toBe("SR");
  });
  it("uses first two letters for a single word", () => {
    expect(initials("acme")).toBe("AC");
  });
  it("falls back to ? for empty", () => {
    expect(initials("  ")).toBe("?");
  });
});
