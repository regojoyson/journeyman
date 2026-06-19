import { describe, it, expect, vi } from "vitest";

vi.mock("./crypto.ts", () => ({
  seal: () => ({ ciphertext: Buffer.from("c"), iv: Buffer.from("i"), authTag: Buffer.from("t") }),
  open: () => "decrypted",
}));

import { insertWorkspaceSecret, listOrgSecrets, fetchForResolve } from "./db.ts";

type Call = { text: string; params?: unknown[] };
function fakeDb(responder: (c: Call, i: number) => { rows: any[] }) {
  const calls: Call[] = [];
  return {
    calls,
    async query(text: string, params?: unknown[]) { calls.push({ text, params }); return responder({ text, params }, calls.length - 1); },
  } as any;
}
const ROW = {
  id: "s1", org_id: "o1", workspace_id: "w1", name: "API_KEY", description: null,
  created_by: "u1", created_at: "2026-06-19T00:00:00Z", updated_at: "2026-06-19T00:00:00Z",
};

describe("secrets db (workspace scope)", () => {
  it("insertWorkspaceSecret writes workspace_id and maps record", async () => {
    const db = fakeDb(() => ({ rows: [ROW] }));
    const rec = await insertWorkspaceSecret(db, { orgId: "o1", workspaceId: "w1", name: "API_KEY", value: "v", createdBy: "u1" });
    expect(rec.workspaceId).toBe("w1");
    expect(db.calls[0].text).toMatch(/insert into jm_secrets/i);
    expect(db.calls[0].params?.[0]).toBe("o1");
    expect(db.calls[0].params?.[1]).toBe("w1");
  });

  it("listOrgSecrets filters workspace_id IS NULL", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    await listOrgSecrets(db, "o1");
    expect(db.calls[0].text).toMatch(/workspace_id is null/i);
  });

  it("fetchForResolve with workspaceId uses (workspace_id = $3 OR workspace_id IS NULL)", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    await fetchForResolve(db, "o1", "w1", ["API_KEY"]);
    expect(db.calls[0].text).toMatch(/workspace_id = \$3 or workspace_id is null/i);
    expect(db.calls[0].params).toEqual(["o1", ["API_KEY"], "w1"]);
  });

  it("fetchForResolve without workspaceId queries org tier only", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    await fetchForResolve(db, "o1", null, ["API_KEY"]);
    expect(db.calls[0].text).toMatch(/workspace_id is null/i);
    expect(db.calls[0].params).toEqual(["o1", ["API_KEY"]]);
  });
});
