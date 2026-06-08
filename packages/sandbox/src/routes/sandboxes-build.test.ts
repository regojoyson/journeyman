import { describe, it, expect, vi } from "vitest";
import { applyImageStateOnSave } from "../db.ts";

describe("applyImageStateOnSave", () => {
  it("marks pending for a ref image on a docker target", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await applyImageStateOnSave(db as any, "t1", "docker", { image: { kind: "ref", imageRef: "node:20" } });
    expect(db.query.mock.calls[0][0]).toContain("image_state = 'pending'");
  });

  it("marks pending for a dockerfile image", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await applyImageStateOnSave(db as any, "t1", "docker", { image: { kind: "dockerfile", content: "FROM x\n" } });
    expect(db.query.mock.calls[0][0]).toContain("image_state = 'pending'");
  });

  it("clears state for an empty image", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await applyImageStateOnSave(db as any, "t1", "docker", { image: { kind: "ref", imageRef: "" } });
    expect(db.query.mock.calls[0][0]).toContain("image_state = 'none'");
  });

  it("no-ops for a local target", async () => {
    const db = { query: vi.fn() };
    await applyImageStateOnSave(db as any, "t1", "local", {});
    expect(db.query).not.toHaveBeenCalled();
  });
});
