import { describe, it, expect, vi } from "vitest";
import {
  markImagePending, markImagePendingIfBuildable, claimPendingBuild, commitBuildResult, failBuild,
} from "./db.ts";

function db(rows: any[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe("build lifecycle DB ops", () => {
  it("markImagePending flips state to pending and clears error", async () => {
    const d = db([{ id: "t1" }]);
    await markImagePending(d as any, "t1");
    const [sql, params] = d.query.mock.calls[0];
    expect(sql).toContain("image_state = 'pending'");
    expect(sql).toContain("image_error = NULL");
    expect(params).toEqual(["t1"]);
  });

  it("markImagePendingIfBuildable guards against overwriting an in-flight build", async () => {
    const d = db([]);
    await markImagePendingIfBuildable(d as any, "t1");
    const [sql, params] = d.query.mock.calls[0];
    expect(sql).toContain("image_state = 'pending'");
    // must NOT knock a 'pending' or 'building' row back to 'pending' (dup-build race)
    expect(sql).toContain("image_state NOT IN ('pending', 'building')");
    expect(params).toEqual(["t1"]);
  });

  it("claimPendingBuild leases pending or stale-building rows", async () => {
    const d = db([{ id: "t1", config: {}, image_state: "building" }]);
    const r = await claimPendingBuild(d as any, "owner-1", 60_000);
    const [sql] = d.query.mock.calls[0];
    expect(sql).toContain("image_state = 'building'");
    expect(sql).toContain("build_owner");
    expect(r?.id).toBe("t1");
  });

  it("claimPendingBuild returns null when nothing is claimable", async () => {
    expect(await claimPendingBuild(db([]) as any, "o", 1000)).toBeNull();
  });

  it("commitBuildResult sets ready with the built fingerprint + ref", async () => {
    const d = db([{ id: "t1" }]);
    await commitBuildResult(d as any, "t1", "fp123", "journeyman/jm-built:fp123");
    const [sql, params] = d.query.mock.calls[0];
    expect(sql).toContain("image_state = 'ready'");
    expect(sql).toContain("image_fingerprint = $2");
    expect(params).toEqual(["t1", "fp123", "journeyman/jm-built:fp123"]);
  });

  it("failBuild stores the error and fingerprint", async () => {
    const d = db([{ id: "t1" }]);
    await failBuild(d as any, "t1", "fp123", "boom");
    const [sql, params] = d.query.mock.calls[0];
    expect(sql).toContain("image_state = 'failed'");
    expect(params).toEqual(["t1", "fp123", "boom"]);
  });
});
