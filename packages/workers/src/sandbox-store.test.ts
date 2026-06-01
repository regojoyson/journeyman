import { describe, it, expect } from "vitest";
import type { Queryable } from "./db.ts";
import { recordSandbox, getSandbox, markSandboxDestroyed, listActiveSandboxes } from "./sandbox-store.ts";

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
  it("recordSandbox upserts the active row", async () => {
    const db = fakeDb();
    await recordSandbox(db, { runId: "r1", type: "docker", handle: "c1", volume: "v1", imageRef: "x:1", owner: "o1" });
    expect(db.calls[0].text).toMatch(/insert into jm_sandbox_instances/i);
    expect(db.calls[0].params).toEqual(["r1", "docker", "c1", "v1", "x:1", "o1"]);
  });

  it("getSandbox returns the row by runId or null", async () => {
    const found = fakeDb([{ run_id: "r1", type: "docker", handle: "c1", volume: "v1", status: "active" }]);
    expect((await getSandbox(found, "r1"))?.handle).toBe("c1");
    const none = fakeDb([]);
    expect(await getSandbox(none, "r1")).toBeNull();
  });

  it("markSandboxDestroyed sets status + destroyed_at", async () => {
    const db = fakeDb();
    await markSandboxDestroyed(db, "r1");
    expect(db.calls[0].text).toMatch(/update jm_sandbox_instances/i);
    expect(db.calls[0].text).toMatch(/status = 'destroyed'/i);
    expect(db.calls[0].params).toEqual(["r1"]);
  });

  it("listActiveSandboxes filters status = active", async () => {
    const db = fakeDb([]);
    await listActiveSandboxes(db);
    expect(db.calls[0].text).toMatch(/where status = 'active'/i);
  });
});
