import { describe, it, expect } from "vitest";
import type { Queryable } from "./db.ts";
import { resolveSandbox, SandboxNotFoundError } from "./resolver.ts";

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

describe("resolveSandbox", () => {
  it("resolves an explicit workerId to a ResolvedSandbox", async () => {
    const r = await resolveSandbox(dbReturning([dockerRow]), { orgId: "o1" }, "w1");
    expect(r).toEqual({
      id: "w1",
      type: "docker",
      executionMode: "per-instance",
      connectivity: "push",
      config: { image: { kind: "ref", imageRef: "x:1" } },
      imageState: "none",
      imageFingerprint: null,
      imageRef: null,
      imageError: null,
    });
  });

  it("throws when no workerId is given (no default fallback)", async () => {
    await expect(
      resolveSandbox(dbReturning([localDefault]), { orgId: "o1" }, undefined),
    ).rejects.toBeInstanceOf(SandboxNotFoundError);
  });

  it("throws SandboxNotFoundError when an explicit workerId is missing", async () => {
    await expect(
      resolveSandbox(dbReturning([]), { orgId: "o1" }, "ghost"),
    ).rejects.toBeInstanceOf(SandboxNotFoundError);
  });
});
