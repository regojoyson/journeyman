import { describe, it, expect } from "vitest";
import type { Queryable } from "./db-workspaces.ts";
import {
  createWorkspace,
  getWorkspace,
  listWorkspacesForOrg,
  upsertWorkspaceMember,
  getWorkspaceMember,
  listWorkspaceMembers,
} from "./db-workspaces.ts";

type Call = { text: string; params?: unknown[] };
function fakeDb(responder: (call: Call, i: number) => { rows: any[] }) {
  const calls: Call[] = [];
  const db: Queryable & { calls: Call[] } = {
    calls,
    async query(text: string, params?: unknown[]) {
      const call = { text, params };
      const i = calls.length;
      calls.push(call);
      return responder(call, i);
    },
  };
  return db;
}

const WS_ROW = {
  id: "w1", org_id: "o1", slug: "default", name: "Default",
  created_at: "2026-06-18T00:00:00Z", updated_at: "2026-06-18T00:00:00Z",
};
const MEMBER_ROW = {
  id: "m1", workspace_id: "w1", user_id: "u1", role: "maintainer",
  permissions: null, created_at: "2026-06-18T00:00:00Z",
};

describe("workspace store", () => {
  it("createWorkspace inserts and maps row->record", async () => {
    const db = fakeDb(() => ({ rows: [WS_ROW] }));
    const rec = await createWorkspace(db, { orgId: "o1", slug: "default", name: "Default" });
    expect(rec.id).toBe("w1");
    expect(rec.orgId).toBe("o1");
    expect(db.calls[0].text).toMatch(/insert into jm_workspaces/i);
    expect(db.calls[0].params).toEqual(["o1", "default", "Default"]);
  });

  it("getWorkspace returns null when no row", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    expect(await getWorkspace(db, "missing")).toBeNull();
  });

  it("listWorkspacesForOrg filters by org and orders by name", async () => {
    const db = fakeDb(() => ({ rows: [WS_ROW] }));
    const rows = await listWorkspacesForOrg(db, "o1");
    expect(rows).toHaveLength(1);
    expect(db.calls[0].text).toMatch(/where org_id = \$1/i);
    expect(db.calls[0].params).toEqual(["o1"]);
  });

  it("upsertWorkspaceMember upserts on (workspace_id,user_id) and maps record", async () => {
    const db = fakeDb(() => ({ rows: [MEMBER_ROW] }));
    const rec = await upsertWorkspaceMember(db, { workspaceId: "w1", userId: "u1", role: "maintainer" });
    expect(rec.role).toBe("maintainer");
    expect(rec.permissions).toBeNull();
    expect(db.calls[0].text).toMatch(/on conflict \(workspace_id, user_id\) do update/i);
    expect(db.calls[0].params).toEqual(["w1", "u1", "maintainer"]);
  });

  it("getWorkspaceMember returns null when absent", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    expect(await getWorkspaceMember(db, "w1", "nobody")).toBeNull();
  });

  it("listWorkspaceMembers filters by workspace", async () => {
    const db = fakeDb(() => ({ rows: [MEMBER_ROW] }));
    const rows = await listWorkspaceMembers(db, "w1");
    expect(rows[0].userId).toBe("u1");
    expect(db.calls[0].params).toEqual(["w1"]);
  });
});
