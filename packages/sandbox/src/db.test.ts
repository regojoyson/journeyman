import { describe, it, expect } from "vitest";
import type { Queryable } from "./db.ts";
import {
  insertSandbox,
  listSandboxes,
  getSandbox,
  deleteSandbox,
  listVisibleSandboxes,
  fetchSandboxById,
} from "./db.ts";

/** Records the last query and returns canned rows. */
function fakeDb(rows: any[] = []): Queryable & { calls: Array<{ text: string; params?: unknown[] }> } {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  return {
    calls,
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return { rows };
    },
  };
}

const row = {
  id: "w1", scope: "org", org_id: "o1", user_id: null, name: "Java builder",
  type: "docker", execution_mode: "per-instance", connectivity: "push",
  config: {}, is_default: false, tags: [], enabled: true,
  created_by: "u1", created_at: new Date(), updated_at: new Date(),
};

describe("workers db store", () => {
  it("insertSandbox INSERTs and returns the mapped record", async () => {
    const db = fakeDb([row]);
    const rec = await insertSandbox(db, {
      scope: "org", orgId: "o1", userId: null, name: "Java builder",
      type: "docker", executionMode: "per-instance", connectivity: "push",
      config: {}, createdBy: "u1",
    });
    expect(db.calls[0].text).toMatch(/insert into jm_sandboxes/i);
    expect(rec.id).toBe("w1");
    expect(rec.type).toBe("docker");
  });

  it("listSandboxes scopes org rows with user_id IS NULL", async () => {
    const db = fakeDb([row]);
    await listSandboxes(db, { orgId: "o1", userId: null });
    expect(db.calls[0].text).toMatch(/user_id is null/i);
    expect(db.calls[0].params).toEqual(["o1"]);
  });

  it("listSandboxes scopes user rows with user_id = $2", async () => {
    const db = fakeDb([row]);
    await listSandboxes(db, { orgId: "o1", userId: "u1" });
    expect(db.calls[0].text).toMatch(/user_id = \$2/i);
    expect(db.calls[0].params).toEqual(["o1", "u1"]);
  });

  it("getSandbox returns null when no row", async () => {
    const db = fakeDb([]);
    const rec = await getSandbox(db, "missing", "o1", null);
    expect(rec).toBeNull();
  });

  it("deleteSandbox returns false when nothing deleted", async () => {
    const db = { async query() { return { rows: [] }; } } as Queryable;
    expect(await deleteSandbox(db, "x", "o1", null)).toBe(false);
  });

  it("listVisibleSandboxes includes system + org + user scope", async () => {
    const db = fakeDb([row]);
    await listVisibleSandboxes(db, "o1", "u1");
    expect(db.calls[0].text).toMatch(/scope = 'system'/i);
    expect(db.calls[0].params).toEqual(["o1", "u1"]);
  });

  it("fetchSandboxById matches system OR org OR user scope", async () => {
    const db = fakeDb([row]);
    const rec = await fetchSandboxById(db, "o1", "u1", "w1");
    expect(db.calls[0].text).toMatch(/where id = \$1/i);
    expect(db.calls[0].params).toEqual(["w1", "o1", "u1"]);
    expect(rec?.id).toBe("w1");
  });
});
