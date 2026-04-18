import assert from "node:assert/strict";
import { resolveSession } from "./session.ts";

// Case 1: caller provides an id → resume that id
{
  const { sessionId, queryOption } = resolveSession("abc-123");
  assert.equal(sessionId, "abc-123");
  assert.deepEqual(queryOption, { resume: "abc-123" });
}

// Case 2: caller omits the id → fresh UUID, pass as sessionId
{
  const { sessionId, queryOption } = resolveSession();
  assert.match(
    sessionId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  assert.deepEqual(queryOption, { sessionId });
}

// Case 3: empty string counts as "not provided" (matches ?? semantics we rely on)
{
  const { sessionId, queryOption } = resolveSession("");
  assert.notEqual(sessionId, "");
  assert.ok("sessionId" in queryOption);
}

console.log("resolveSession: all assertions passed");
