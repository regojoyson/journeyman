import { describe, it, expect } from "vitest";
import type { Queryable } from "./db.ts";
import {
  insertSandbox,
  updateSandbox,
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
  id: "w1", scope: "org", org_id: "o1", name: "Java builder",
  type: "docker", execution_mode: "per-instance", connectivity: "push",
  config: {}, is_default: false, tags: [], enabled: true,
  created_by: "u1", created_at: new Date(), updated_at: new Date(),
};

describe("sandboxes db store", () => {
  it("insertSandbox INSERTs (no user_id) and returns the mapped record", async () => {
    const db = fakeDb([row]);
    const rec = await insertSandbox(db, {
      scope: "org", orgId: "o1", name: "Java builder",
      type: "docker", executionMode: "per-instance", connectivity: "push",
      config: {}, createdBy: "u1",
    });
    expect(db.calls[0].text).toMatch(/insert into jm_sandboxes/i);
    expect(db.calls[0].text).not.toMatch(/user_id/i);
    expect(rec.id).toBe("w1");
    expect(rec.type).toBe("docker");
  });

  it("listSandboxes scopes by org only", async () => {
    const db = fakeDb([row]);
    await listSandboxes(db, "o1");
    expect(db.calls[0].text).toMatch(/where org_id = \$1/i);
    expect(db.calls[0].text).not.toMatch(/user_id/i);
    expect(db.calls[0].params).toEqual(["o1"]);
  });

  it("getSandbox returns null when no row", async () => {
    const db = fakeDb([]);
    const rec = await getSandbox(db, "missing", "o1");
    expect(rec).toBeNull();
  });

  it("deleteSandbox returns false when nothing deleted", async () => {
    const db = { async query() { return { rows: [] }; } } as Queryable;
    expect(await deleteSandbox(db, "x", "o1")).toBe(false);
  });

  it("listVisibleSandboxes includes system + org scope only", async () => {
    const db = fakeDb([row]);
    await listVisibleSandboxes(db, "o1");
    expect(db.calls[0].text).toMatch(/scope = 'system'/i);
    expect(db.calls[0].text).toMatch(/scope = 'org'/i);
    expect(db.calls[0].text).not.toMatch(/scope = 'user'/i);
    expect(db.calls[0].params).toEqual(["o1"]);
  });

  it("fetchSandboxById matches system OR org scope", async () => {
    const db = fakeDb([row]);
    const rec = await fetchSandboxById(db, "o1", "w1");
    expect(db.calls[0].text).toMatch(/where id = \$1/i);
    expect(db.calls[0].text).not.toMatch(/scope = 'user'/i);
    expect(db.calls[0].params).toEqual(["w1", "o1"]);
    expect(rec?.id).toBe("w1");
  });
});

describe("db maxConcurrentInstances wiring", () => {
  it("insertSandbox sends max_concurrent_instances as a value", async () => {
    const db = fakeDb([row]);
    await insertSandbox(db, {
      scope: "org", orgId: "o1", name: "n", type: "docker",
      executionMode: "per-instance", createdBy: "u1", maxConcurrentInstances: 4,
    });
    expect(db.calls[0].text).toMatch(/max_concurrent_instances/);
    expect(db.calls[0].params).toContain(4);
  });

  it("updateSandbox sets the column only when provided", async () => {
    const db = fakeDb([{ id: "x" }]);
    await updateSandbox(db, { id: "x", orgId: "o1", maxConcurrentInstances: null });
    expect(db.calls[0].text).toMatch(/max_concurrent_instances = \$1/);
    expect(db.calls[0].params?.[0]).toBeNull();
  });

  it("updateSandbox omits the column when not provided", async () => {
    const db = fakeDb([{ id: "x" }]);
    await updateSandbox(db, { id: "x", orgId: "o1", name: "renamed" });
    expect(db.calls[0].text).not.toMatch(/max_concurrent_instances/);
  });
});
