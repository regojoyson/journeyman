import { describe, it, expect } from "vitest";
import type { Queryable } from "./db.ts";
import { resolveWorker, WorkerNotFoundError } from "./resolver.ts";

const dockerRow = {
  id: "w1", scope: "org", org_id: "o1", user_id: null, name: "Java builder",
  type: "docker", execution_mode: "per-instance", connectivity: "push",
  config: { image: { kind: "ref", imageRef: "x:1" } }, is_default: false, tags: [],
  enabled: true, created_by: "u1", created_at: new Date(), updated_at: new Date(),
};
const localDefault = {
  ...dockerRow, id: "sys", scope: "system", org_id: null, user_id: null,
  name: "Local Workspace", type: "local", execution_mode: "shared", connectivity: null,
  config: {}, is_default: true,
};

function dbReturning(rows: any[]): Queryable {
  return { async query() { return { rows }; } };
}

describe("resolveWorker", () => {
  it("resolves an explicit workerId to a ResolvedWorker", async () => {
    const r = await resolveWorker(dbReturning([dockerRow]), { orgId: "o1", userId: "u1" }, "w1");
    expect(r).toEqual({
      id: "w1",
      type: "docker",
      executionMode: "per-instance",
      connectivity: "push",
      config: { image: { kind: "ref", imageRef: "x:1" } },
    });
  });

  it("falls back to the default worker when workerId is undefined", async () => {
    const r = await resolveWorker(dbReturning([localDefault]), { orgId: "o1", userId: "u1" }, undefined);
    expect(r.id).toBe("sys");
    expect(r.type).toBe("local");
    expect(r.connectivity).toBeUndefined();
  });

  it("throws WorkerNotFoundError when an explicit workerId is missing", async () => {
    await expect(
      resolveWorker(dbReturning([]), { orgId: "o1", userId: "u1" }, "ghost"),
    ).rejects.toBeInstanceOf(WorkerNotFoundError);
  });

  it("throws WorkerNotFoundError when no default exists", async () => {
    await expect(
      resolveWorker(dbReturning([]), { orgId: "o1", userId: "u1" }, undefined),
    ).rejects.toBeInstanceOf(WorkerNotFoundError);
  });
});
