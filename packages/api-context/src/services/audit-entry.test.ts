import { describe, it, expect } from "vitest";
import { buildAuditEntry } from "./audit-entry.ts";

const rc = {
  user: { id: "u1" },
  org: { id: "o1" },
  workspace: { orgId: "ws-org" },
};

describe("buildAuditEntry", () => {
  it("returns null for a non-2xx response", () => {
    expect(buildAuditEntry({
      statusCode: 404, tag: { action: "workflow.update", targetType: "workflow" },
      runContext: rc, params: { id: "w1" },
    })).toBeNull();
  });

  it("returns null when there is no audit tag", () => {
    expect(buildAuditEntry({
      statusCode: 200, tag: undefined, runContext: rc, params: { id: "w1" },
    })).toBeNull();
  });

  it("returns null when there is no runContext (unauthenticated)", () => {
    expect(buildAuditEntry({
      statusCode: 200, tag: { action: "x", targetType: "y" },
      runContext: undefined, params: {},
    })).toBeNull();
  });

  it("prefers the workspace orgId over the org id", () => {
    const e = buildAuditEntry({
      statusCode: 200, tag: { action: "workflow.update", targetType: "workflow" },
      runContext: rc, params: { id: "w1" },
    });
    expect(e).toEqual({
      orgId: "ws-org", actorUserId: "u1", action: "workflow.update",
      targetType: "workflow", targetId: "w1", detail: {},
    });
  });

  it("falls back to the org id when there is no workspace", () => {
    const e = buildAuditEntry({
      statusCode: 200, tag: { action: "org.update", targetType: "org" },
      runContext: { user: { id: "u1" }, org: { id: "o1" } }, params: {},
    });
    expect(e!.orgId).toBe("o1");
    expect(e!.targetId).toBeNull();
  });

  it("reads targetId from a custom idParam", () => {
    const e = buildAuditEntry({
      statusCode: 200, tag: { action: "membership.update", targetType: "membership", idParam: "userId" },
      runContext: rc, params: { orgId: "o1", userId: "u9" },
    });
    expect(e!.targetId).toBe("u9");
  });

  it("prefers an explicit targetId (create routes) over params", () => {
    const e = buildAuditEntry({
      statusCode: 201, tag: { action: "workflow.create", targetType: "workflow" },
      runContext: rc, params: {}, explicitTargetId: "new-id", detail: { name: "X" },
    });
    expect(e!.targetId).toBe("new-id");
    expect(e!.detail).toEqual({ name: "X" });
  });
});
