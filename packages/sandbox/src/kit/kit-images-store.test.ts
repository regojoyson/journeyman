import { describe, it, expect, vi } from "vitest";
import { upsertKitImage, getKitImage, resolveKitRefs } from "./kit-images-store.ts";

function fakeDb(rows: any[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe("kit-images-store", () => {
  it("upsertKitImage issues an INSERT ... ON CONFLICT upsert", async () => {
    const db = fakeDb();
    await upsertKitImage(db, "bundle", "reg/runner-bundle@sha256:abc");
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/insert into kit_images/i);
    expect(sql).toMatch(/on conflict\s*\(role\)\s*do update/i);
    expect(params).toEqual(["bundle", "reg/runner-bundle@sha256:abc"]);
  });

  it("getKitImage returns the image_ref or null", async () => {
    expect(await getKitImage(fakeDb([{ image_ref: "reg/x@sha256:1" }]), "base")).toBe("reg/x@sha256:1");
    expect(await getKitImage(fakeDb([]), "base")).toBeNull();
  });

  it("resolveKitRefs returns DB rows when present", async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ image_ref: "reg/base@sha256:b" }] })
        .mockResolvedValueOnce({ rows: [{ image_ref: "reg/bundle@sha256:c" }] }),
    };
    expect(await resolveKitRefs(db, { base: "fallback-base", bundle: "fallback-bundle" }))
      .toEqual({ base: "reg/base@sha256:b", bundle: "reg/bundle@sha256:c" });
  });

  it("resolveKitRefs falls back to provided defaults when a row is missing", async () => {
    const db = fakeDb([]); // every query → no rows
    expect(await resolveKitRefs(db, { base: "fallback-base", bundle: "fallback-bundle" }))
      .toEqual({ base: "fallback-base", bundle: "fallback-bundle" });
  });
});
