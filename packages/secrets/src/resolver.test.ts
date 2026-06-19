import { describe, it, expect, vi } from "vitest";
import type { RunContext } from "@journeyman/core";

vi.mock("./db.ts", () => ({
  validateName: () => {},
  fetchForResolve: vi.fn(),
}));
import { fetchForResolve } from "./db.ts";
import { resolveSecrets } from "./resolver.ts";

function ctx(workspaceId: string | null): RunContext {
  return {
    user: { id: "u1", username: "a" },
    org: { id: "o1", slug: "acme" },
    membershipId: "m1", role: "member", isPlatformAdmin: false, tokenKind: "access-jwt",
    workspace: workspaceId ? { id: workspaceId, orgId: "o1", role: "contributor", permissions: [] } : undefined,
  };
}

describe("resolveSecrets (workspace > org)", () => {
  it("workspace-scope row wins over org-scope row", async () => {
    (fetchForResolve as any).mockResolvedValue([
      { name: "API_KEY", workspaceId: null, value: "org-val" },
      { name: "API_KEY", workspaceId: "w1", value: "ws-val" },
    ]);
    const r = await resolveSecrets({ pool: {} as any, ctx: ctx("w1"), names: ["API_KEY"] });
    expect(r.values.API_KEY).toBe("ws-val");
  });

  it("falls back to org-scope when no workspace row", async () => {
    (fetchForResolve as any).mockResolvedValue([{ name: "API_KEY", workspaceId: null, value: "org-val" }]);
    const r = await resolveSecrets({ pool: {} as any, ctx: ctx("w1"), names: ["API_KEY"] });
    expect(r.values.API_KEY).toBe("org-val");
  });

  it("with no workspace in context, resolves org tier only", async () => {
    (fetchForResolve as any).mockResolvedValue([{ name: "API_KEY", workspaceId: null, value: "org-val" }]);
    const r = await resolveSecrets({ pool: {} as any, ctx: ctx(null), names: ["API_KEY"] });
    expect(r.values.API_KEY).toBe("org-val");
    expect((fetchForResolve as any).mock.calls.at(-1)[2]).toBeNull();
  });

  it("throws MissingSecretsError when unresolved", async () => {
    (fetchForResolve as any).mockResolvedValue([]);
    await expect(resolveSecrets({ pool: {} as any, ctx: ctx("w1"), names: ["NOPE"] })).rejects.toThrow();
  });
});
