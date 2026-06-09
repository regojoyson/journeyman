import { describe, it, expect } from "vitest";
import type { Queryable } from "./db.ts";
import { recordSandboxInstance, getSandboxInstance, markSandboxInstanceDestroyed, listActiveSandboxInstances } from "./sandbox-instance-store.ts";

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

describe("sandbox-store", () => {
  it("recordSandboxInstance upserts the active row (connection serialized)", async () => {
    const db = fakeDb();
    await recordSandboxInstance(db, {
      runId: "r1", type: "docker", handle: "c1", volume: "v1", imageRef: "x:1", owner: "o1",
      connection: { host: "tcp://h:2376" },
    });
    expect(db.calls[0].text).toMatch(/insert into jm_sandbox_instances/i);
    expect(db.calls[0].params).toEqual([
      "r1", "docker", "c1", "v1", "x:1", "o1", JSON.stringify({ host: "tcp://h:2376" }),
    ]);
  });

  it("recordSandboxInstance stores null connection when omitted", async () => {
    const db = fakeDb();
    await recordSandboxInstance(db, { runId: "r1", type: "docker", handle: "c1" });
    expect(db.calls[0].params?.[6]).toBeNull();
  });

  it("getSandboxInstance returns the row by runId or null", async () => {
    const found = fakeDb([{ run_id: "r1", type: "docker", handle: "c1", volume: "v1", status: "active" }]);
    expect((await getSandboxInstance(found, "r1"))?.handle).toBe("c1");
    const none = fakeDb([]);
    expect(await getSandboxInstance(none, "r1")).toBeNull();
  });

  it("markSandboxInstanceDestroyed sets status + destroyed_at", async () => {
    const db = fakeDb();
    await markSandboxInstanceDestroyed(db, "r1");
    expect(db.calls[0].text).toMatch(/update jm_sandbox_instances/i);
    expect(db.calls[0].text).toMatch(/status = 'destroyed'/i);
    expect(db.calls[0].params).toEqual(["r1"]);
  });

  it("listActiveSandboxInstances filters status = active", async () => {
    const db = fakeDb([]);
    await listActiveSandboxInstances(db);
    expect(db.calls[0].text).toMatch(/where status = 'active'/i);
  });
});
