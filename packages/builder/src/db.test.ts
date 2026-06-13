import { describe, it, expect } from "vitest";
import type { Queryable } from "./db.ts";
import {
  insertBuilderSession,
  listBuilderSessions,
  getBuilderSession,
  updateBuilderSession,
  deleteBuilderSession,
} from "./db.ts";

type Call = { text: string; params?: unknown[] };

/** Fake Queryable. `responder` returns rows (or throws) per call index. */
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

const ROW = {
  id: "s1", org_id: "o1", user_id: "u1", name: "PR security review",
  status: "active", messages: [], build_plan: null, applied_flow_id: null,
  created_by: "u1", created_at: "2026-06-13T00:00:00Z", updated_at: "2026-06-13T00:00:00Z",
};

describe("builder session store", () => {
  it("insert maps row→record and sends the right columns", async () => {
    const db = fakeDb(() => ({ rows: [ROW] }));
    const rec = await insertBuilderSession(db, {
      orgId: "o1", userId: "u1", name: "PR security review", createdBy: "u1",
    });
    expect(rec.id).toBe("s1");
    expect(rec.name).toBe("PR security review");
    expect(db.calls[0].text).toMatch(/insert into jm_builder_sessions/i);
    expect(db.calls[0].params).toEqual([
      "o1", "u1", "PR security review", "[]", null, "u1",
    ]);
  });

  it("insert suffixes the name on a unique-constraint collision", async () => {
    const db = fakeDb((_call, i) => {
      if (i === 0) { const e: any = new Error("dup"); e.code = "23505"; throw e; }
      return { rows: [{ ...ROW, name: "PR security review (2)" }] };
    });
    const rec = await insertBuilderSession(db, {
      orgId: "o1", userId: "u1", name: "PR security review", createdBy: "u1",
    });
    expect(rec.name).toBe("PR security review (2)");
    expect(db.calls).toHaveLength(2);
    expect(db.calls[1].params?.[2]).toBe("PR security review (2)");
  });

  it("list scopes by org + user and orders by updated_at desc", async () => {
    const db = fakeDb(() => ({ rows: [ROW] }));
    const rows = await listBuilderSessions(db, "o1", "u1");
    expect(rows).toHaveLength(1);
    expect(db.calls[0].text).toMatch(/where org_id = \$1 and user_id = \$2/i);
    expect(db.calls[0].text).toMatch(/order by updated_at desc/i);
    expect(db.calls[0].params).toEqual(["o1", "u1"]);
  });

  it("get returns null when no row", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    const rec = await getBuilderSession(db, "missing", "o1", "u1");
    expect(rec).toBeNull();
  });

  it("update builds a dynamic SET clause and appends updated_at = now()", async () => {
    const db = fakeDb(() => ({ rows: [{ ...ROW, status: "applied" }] }));
    const ok = await updateBuilderSession(db, {
      id: "s1", orgId: "o1", userId: "u1", status: "applied", appliedFlowId: "f1",
    });
    expect(ok).toBe(true);
    expect(db.calls[0].text).toMatch(/update jm_builder_sessions set/i);
    expect(db.calls[0].text).toMatch(/updated_at = now\(\)/i);
    expect(db.calls[0].text).toMatch(/status = \$/);
    expect(db.calls[0].text).toMatch(/applied_flow_id = \$/);
  });

  it("delete returns false when nothing was removed", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    const ok = await deleteBuilderSession(db, "s1", "o1", "u1");
    expect(ok).toBe(false);
  });
});
