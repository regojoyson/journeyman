import { describe, it, expect, vi } from "vitest";
import { audit, listAudit } from "./audit.ts";

describe("audit", () => {
  it("inserts an entry with the right columns", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await audit({ query } as any, {
      orgId: "o1",
      actorUserId: "u1",
      action: "agent.enable",
      targetType: "agent",
      targetId: "a1",
      detail: { x: 1 },
    });
    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO jm_audit_log");
    expect(params.slice(0, 5)).toEqual(["o1", "u1", "agent.enable", "agent", "a1"]);
    expect(JSON.parse(params[5])).toEqual({ x: 1 });
  });

  it("never throws when the insert fails", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(
      audit({ query } as any, { orgId: "o1", actorUserId: null, action: "a", targetType: "agent" }),
    ).resolves.toBeUndefined();
  });
});

describe("listAudit", () => {
  it("clamps the limit and orders by created_at desc", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await listAudit({ query } as any, "o1", { limit: 9999 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("ORDER BY created_at DESC");
    expect(params).toEqual(["o1", 200]); // clamped to 200
  });

  it("adds a before cursor when provided", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await listAudit({ query } as any, "o1", { before: "2026-06-18T00:00:00Z", limit: 10 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("created_at <");
    expect(params).toEqual(["o1", "2026-06-18T00:00:00Z", 10]);
  });
});
