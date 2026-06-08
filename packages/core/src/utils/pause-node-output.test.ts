import assert from "node:assert/strict";
import type { WorkflowNode } from "../types/flow.types.ts";
import { pauseNodeOutputSchema } from "./pause-node-output.ts";
import { test } from "vitest";

test("pause-node-output (assertions)", () => {
  // Webhook Wait: reserved keys + one declared output.
  const webhookNode = {
    id: "ww_1",
    type: "webhook-wait",
    config: {
      outputs: [{ name: "issueNumber", type: "number" }],
    },
  } as unknown as WorkflowNode;

  const ww = pauseNodeOutputSchema(webhookNode);
  assert.ok(ww, "webhook-wait should produce a schema");
  assert.deepEqual(ww!.payload, { type: "object", fields: {} }, "payload is an object");
  assert.deepEqual(ww!.resolvedAt, { type: "string" });
  assert.deepEqual(ww!.source, { type: "string" });
  assert.deepEqual(ww!.webhookEventId, { type: "string" });
  assert.deepEqual(ww!.issueNumber, { type: "number" }, "declared number output");

  // Human Task: reserved set has `actor`, not `webhookEventId`.
  const humanNode = {
    id: "ht_1",
    type: "human-task",
    config: { outputs: [{ name: "approved", type: "boolean" }] },
  } as unknown as WorkflowNode;

  const ht = pauseNodeOutputSchema(humanNode);
  assert.ok(ht, "human-task should produce a schema");
  assert.deepEqual(ht!.actor, { type: "string" });
  assert.equal(ht!.webhookEventId, undefined, "human-task has no webhookEventId");
  assert.deepEqual(ht!.approved, { type: "boolean" });

  // json/date declared outputs map correctly.
  const jsonNode = {
    id: "ww_2",
    type: "webhook-wait",
    config: { outputs: [{ name: "blob", type: "json" }, { name: "when", type: "date" }] },
  } as unknown as WorkflowNode;
  const j = pauseNodeOutputSchema(jsonNode);
  assert.deepEqual(j!.blob, { type: "object", fields: {} }, "json output is an object");
  assert.deepEqual(j!.when, { type: "string" }, "date output is a string");

  // Non-pause node → null.
  const stepNode = { id: "s_1", type: "step", stepType: "custom-ai", config: {} } as unknown as WorkflowNode;
  assert.equal(pauseNodeOutputSchema(stepNode), null, "non-pause node returns null");

  // Missing config / outputs → reserved keys only, no throw.
  const bare = { id: "ww_3", type: "webhook-wait" } as unknown as WorkflowNode;
  const b = pauseNodeOutputSchema(bare);
  assert.ok(b, "bare pause node still returns reserved keys");
  assert.deepEqual(b!.payload, { type: "object", fields: {} });
});
