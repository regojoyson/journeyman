import assert from "node:assert/strict";
import { eventTypeHeaderForSample } from "./webhook-test-delivery.ts";

// Header-based provider + a chosen sample key → set that header to the key.
assert.deepEqual(
  eventTypeHeaderForSample("header:x-github-event", "release"),
  { name: "x-github-event", value: "release" },
);

// Header name is lowercased.
assert.deepEqual(
  eventTypeHeaderForSample("header:X-GitHub-Event", "push"),
  { name: "x-github-event", value: "push" },
);

// Body-based provider → no header (type is in the payload).
assert.equal(eventTypeHeaderForSample("$.object_kind", "merge_request"), null);
assert.equal(eventTypeHeaderForSample("$.webhookEvent", "issue_created"), null);

// No sample chosen, or no eventTypePath → null.
assert.equal(eventTypeHeaderForSample("header:x-github-event", undefined), null);
assert.equal(eventTypeHeaderForSample(undefined, "release"), null);

console.log("eventTypeHeaderForSample: ok");
