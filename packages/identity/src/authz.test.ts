import { describe, it, expect } from "vitest";
import type { Queryable } from "./db-workspaces.ts";
import { loadWorkspaceAccess, can, makeRequireWorkspacePermission } from "./authz.ts";
import type { RunContext } from "@journeyman/core";

type Call = { text: string; params?: unknown[] };
function fakeDb(responder: (call: Call, i: number) => { rows: any[] }) {
  const calls: Call[] = [];
  return {
    calls,
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return responder({ text, params }, calls.length - 1);
    },
  } as Queryable & { calls: Call[] };
}

const baseCtx: RunContext = {
  user: { id: "u1", username: "alice" },
  org: { id: "o1", slug: "acme" },
  membershipId: "mem1",
  role: "member",
  isPlatformAdmin: false,
  tokenKind: "access-jwt",
};

describe("loadWorkspaceAccess", () => {
  it("returns null when the workspace does not exist", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    expect(await loadWorkspaceAccess(db, "u1", "missing")).toBeNull();
  });
  it("maps org-admin + workspace membership", async () => {
    const db = fakeDb(() => ({ rows: [{ org_id: "o1", org_role: "admin", ws_role: "observer", ws_permissions: null }] }));
    const acc = await loadWorkspaceAccess(db, "u1", "w1");
    expect(acc).toEqual({ orgId: "o1", isOrgAdmin: true, member: { role: "observer", permissions: null } });
  });
  it("synthesizes a contributor when an org member has no workspace membership", async () => {
    const db = fakeDb(() => ({ rows: [{ org_id: "o1", org_role: "member", ws_role: null, ws_permissions: null }] }));
    const acc = await loadWorkspaceAccess(db, "u1", "w1");
    expect(acc).toEqual({ orgId: "o1", isOrgAdmin: false, member: { role: "contributor", permissions: null } });
  });
  it("member null when the user is neither a workspace nor an org member", async () => {
    const db = fakeDb(() => ({ rows: [{ org_id: "o1", org_role: null, ws_role: null, ws_permissions: null }] }));
    const acc = await loadWorkspaceAccess(db, "u1", "w1");
    expect(acc).toEqual({ orgId: "o1", isOrgAdmin: false, member: null });
  });
});

describe("can", () => {
  it("platform admin bypasses DB membership", async () => {
    const db = fakeDb(() => ({ rows: [{ org_id: "o1", org_role: "member", ws_role: null, ws_permissions: null }] }));
    expect(await can(db, { ...baseCtx, isPlatformAdmin: true }, "w1", "settings.manage")).toBe(true);
  });
  it("contributor can write, cannot manage members", async () => {
    const db = fakeDb(() => ({ rows: [{ org_id: "o1", org_role: "member", ws_role: "contributor", ws_permissions: null }] }));
    expect(await can(db, baseCtx, "w1", "resource.write")).toBe(true);
    const db2 = fakeDb(() => ({ rows: [{ org_id: "o1", org_role: "member", ws_role: "contributor", ws_permissions: null }] }));
    expect(await can(db2, baseCtx, "w1", "members.manage")).toBe(false);
  });
  it("false when workspace missing", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    expect(await can(db, baseCtx, "missing", "resource.read")).toBe(false);
  });
});

describe("makeRequireWorkspacePermission", () => {
  function fakeReplyAndReq(ctx: RunContext, wsId: string) {
    const sent: { code?: number; body?: any } = {};
    const reply = {
      code(c: number) { sent.code = c; return reply; },
      send(b: any) { sent.body = b; return reply; },
    };
    const req: any = { params: { wsId }, runContext: { ...ctx } };
    return { req, reply, sent };
  }

  it("403s an observer trying to write", async () => {
    const pool = fakeDb(() => ({ rows: [{ org_id: "o1", org_role: "member", ws_role: "observer", ws_permissions: null }] }));
    const guard = makeRequireWorkspacePermission({ pool: pool as any })("resource.write");
    const { req, reply, sent } = fakeReplyAndReq(baseCtx, "w1");
    await guard(req, reply as any);
    expect(sent.code).toBe(403);
  });

  it("passes a maintainer and sets req.runContext.workspace", async () => {
    const pool = fakeDb(() => ({ rows: [{ org_id: "o1", org_role: "member", ws_role: "maintainer", ws_permissions: null }] }));
    const guard = makeRequireWorkspacePermission({ pool: pool as any })("settings.manage");
    const { req, reply, sent } = fakeReplyAndReq(baseCtx, "w1");
    await guard(req, reply as any);
    expect(sent.code).toBeUndefined();
    expect(req.runContext.workspace).toEqual({
      id: "w1", orgId: "o1", role: "maintainer",
      permissions: expect.arrayContaining(["settings.manage", "resource.write"]),
    });
  });

  it("404s when the workspace does not exist", async () => {
    const pool = fakeDb(() => ({ rows: [] }));
    const guard = makeRequireWorkspacePermission({ pool: pool as any })("resource.read");
    const { req, reply, sent } = fakeReplyAndReq(baseCtx, "missing");
    await guard(req, reply as any);
    expect(sent.code).toBe(404);
  });
});
