import { describe, it, expect } from "vitest";
import type { Queryable } from "./db.ts";
import { recordSandboxInstance, getSandboxInstance, markSandboxInstanceDestroyed, listActiveSandboxInstances } from "./sandbox-instance-store.ts";
import {
  claimSandboxInstance, claimSandboxInstanceWithCapacity, releaseSandboxClaim, SandboxAtCapacityError,
} from "./sandbox-instance-store.ts";

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

describe("claimSandboxInstanceWithCapacity", () => {
  const base = { runId: "r1", type: "docker", owner: "o1", sandboxId: "s1" };

  it("no limit → fast path (plain claim SQL, no advisory lock)", async () => {
    const db = fakeDb([{ run_id: "r1" }]);
    const won = await claimSandboxInstanceWithCapacity(db, { ...base, limit: null });
    expect(won).toBe(true);
    expect(db.calls[0].text).not.toMatch(/pg_advisory_xact_lock/);
    expect(db.calls[0].text).toMatch(/insert into jm_sandbox_instances/i);
  });

  it("under limit → admits (inserted=1)", async () => {
    const db = fakeDb([{ inserted: 1, run_exists: true }]);
    expect(await claimSandboxInstanceWithCapacity(db, { ...base, limit: 5 })).toBe(true);
    expect(db.calls[0].text).toMatch(/pg_advisory_xact_lock/);
  });

  it("at limit + new run → throws SandboxAtCapacityError", async () => {
    const db = fakeDb([{ inserted: 0, run_exists: false }]);
    await expect(claimSandboxInstanceWithCapacity(db, { ...base, limit: 5 }))
      .rejects.toBeInstanceOf(SandboxAtCapacityError);
  });

  it("row already exists (lost race / parallel branch) → false, not a throw", async () => {
    const db = fakeDb([{ inserted: 0, run_exists: true }]);
    expect(await claimSandboxInstanceWithCapacity(db, { ...base, limit: 5 })).toBe(false);
  });
});

describe("releaseSandboxClaim", () => {
  it("deletes only an un-provisioned provisioning row", async () => {
    const db = fakeDb([]);
    await releaseSandboxClaim(db, "r1");
    expect(db.calls[0].text).toMatch(/delete from jm_sandbox_instances/i);
    expect(db.calls[0].text).toMatch(/status = 'provisioning'/i);
    expect(db.calls[0].text).toMatch(/handle = ''/);
    expect(db.calls[0].params).toEqual(["r1"]);
  });
});

describe("claimSandboxInstance sandbox_id", () => {
  it("includes sandbox_id in the insert params", async () => {
    const db = fakeDb([{ run_id: "r1" }]);
    await claimSandboxInstance(db, { runId: "r1", type: "docker", owner: "o1", sandboxId: "s1" });
    expect(db.calls[0].text).toMatch(/sandbox_id/);
    expect(db.calls[0].params).toEqual(["r1", "docker", "o1", "s1"]);
  });
});
