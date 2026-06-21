import { describe, it, expect } from "vitest";
import type { RunContext } from "./types/identity.types.ts";
import { canAccessOrg } from "./org-scope.ts";

const ctx = (over: Partial<RunContext> = {}): RunContext => ({
  user: { id: "u1", username: "alice" },
  org: { id: "home-org", slug: "home" },
  membershipId: "mem1",
  role: "member",
  isPlatformAdmin: false,
  tokenKind: "access-jwt",
  ...over,
});

describe("canAccessOrg", () => {
  it("allows when the route org matches the session org", () => {
    expect(canAccessOrg(ctx(), "home-org")).toBe(true);
  });

  it("denies a non-platform-admin acting on a different org", () => {
    expect(canAccessOrg(ctx(), "other-org")).toBe(false);
  });

  it("allows a platform admin to act on any org (the superadmin fix)", () => {
    expect(canAccessOrg(ctx({ isPlatformAdmin: true }), "other-org")).toBe(true);
  });

  it("allows a platform admin on their own org too", () => {
    expect(canAccessOrg(ctx({ isPlatformAdmin: true }), "home-org")).toBe(true);
  });
});
