import { describe, it, expect } from "vitest";
import { resolveSession } from "./session.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("resolveSession", () => {
  it("echoes a provided id as the correlation sessionId and starts a fresh SDK session", () => {
    const { sessionId, queryOption } = resolveSession("abc-123");
    expect(sessionId).toBe("abc-123");
    // Always a brand-new SDK session (never a resume of the caller's id).
    expect(Object.keys(queryOption)).toEqual(["sessionId"]);
    expect(queryOption.sessionId).toMatch(UUID_RE);
  });

  it("generates a fresh UUID sessionId when none is provided", () => {
    const { sessionId, queryOption } = resolveSession();
    expect(sessionId).toMatch(UUID_RE);
    expect(queryOption.sessionId).toMatch(UUID_RE);
  });

  it("treats an empty string as 'not provided'", () => {
    const { sessionId, queryOption } = resolveSession("");
    expect(sessionId).not.toBe("");
    expect(sessionId).toMatch(UUID_RE);
    expect(queryOption.sessionId).toMatch(UUID_RE);
  });
});
