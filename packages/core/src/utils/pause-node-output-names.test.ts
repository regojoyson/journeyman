import assert from "node:assert/strict";
import type { WorkflowNode } from "../types/flow.types.ts";
import { validatePauseNodeOutputNames } from "./pause-node-output-names.ts";

// Clean webhook-wait → no problems.
const clean = {
  id: "ww_ok",
  type: "webhook-wait",
  config: { outputs: [{ name: "issueNumber", type: "number" }] },
} as unknown as WorkflowNode;
assert.deepEqual(validatePauseNodeOutputNames(clean), [], "clean outputs → no problems");

// Reserved name (webhook-wait): payload.
const reserved = {
  id: "ww_r",
  type: "webhook-wait",
  config: { outputs: [{ name: "payload", type: "json" }] },
} as unknown as WorkflowNode;
const rp = validatePauseNodeOutputNames(reserved);
assert.equal(rp.length, 1);
assert.equal(rp[0].reason, "reserved");
assert.equal(rp[0].index, 0);
assert.equal(rp[0].name, "payload");
assert.match(rp[0].message, /reserved/);

// Reserved name specific to human-task: actor.
const human = {
  id: "ht_r",
  type: "human-task",
  config: { outputs: [{ name: "actor", type: "string" }] },
} as unknown as WorkflowNode;
const hp = validatePauseNodeOutputNames(human);
assert.equal(hp.length, 1);
assert.equal(hp[0].reason, "reserved", "actor is reserved for human-task");

// `actor` is NOT reserved for webhook-wait → allowed.
const wwActor = {
  id: "ww_a",
  type: "webhook-wait",
  config: { outputs: [{ name: "actor", type: "string" }] },
} as unknown as WorkflowNode;
assert.deepEqual(validatePauseNodeOutputNames(wwActor), [], "actor allowed on webhook-wait");

// Duplicate names.
const dup = {
  id: "ww_d",
  type: "webhook-wait",
  config: { outputs: [{ name: "foo", type: "string" }, { name: "foo", type: "number" }] },
} as unknown as WorkflowNode;
const dp = validatePauseNodeOutputNames(dup);
assert.equal(dp.length, 1);
assert.equal(dp[0].reason, "duplicate");
assert.equal(dp[0].index, 1, "second occurrence is the problem");

// Invalid characters / leading digit / empty.
const invalid = {
  id: "ww_i",
  type: "webhook-wait",
  config: { outputs: [{ name: "2bad", type: "string" }, { name: "has space", type: "string" }, { name: "", type: "string" }] },
} as unknown as WorkflowNode;
const ip = validatePauseNodeOutputNames(invalid);
assert.equal(ip.length, 3);
assert.ok(ip.every(p => p.reason === "invalid"), "all three are invalid");

// Non-pause node → no problems.
const step = { id: "s", type: "step", stepType: "custom-ai", config: { outputs: [{ name: "payload" }] } } as unknown as WorkflowNode;
assert.deepEqual(validatePauseNodeOutputNames(step), [], "non-pause node ignored");

// Missing config → no throw, no problems.
const bare = { id: "ww_b", type: "webhook-wait" } as unknown as WorkflowNode;
assert.deepEqual(validatePauseNodeOutputNames(bare), []);

console.log("pause-node-output-names: ok");
