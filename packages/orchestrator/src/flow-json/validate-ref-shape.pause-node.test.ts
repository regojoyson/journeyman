import assert from "node:assert/strict";
import type { WorkflowGraph } from "@journeyman/core";
import { resolveRefShape, type CatalogShapeEntry } from "./validate-ref-shape.ts";

// A flow with a webhook-wait node that declares one output (issueNumber).
const flow = {
  schemaVersion: 2,
  nodes: [
    {
      id: "webhook-wait_pbfs1v",
      type: "webhook-wait",
      displayName: "Webhook Wait",
      config: { outputs: [{ name: "issueNumber", type: "number" }] },
    },
  ],
  edges: [],
} as unknown as WorkflowGraph;

const catalog = new Map<string, CatalogShapeEntry>();

// Reserved meta key resolves (this is the exact reported bug: output.resolvedAt).
const resolvedAt = resolveRefShape(flow, "webhook-wait_pbfs1v.output.resolvedAt", catalog);
assert.equal(resolvedAt.ok, true, `output.resolvedAt should resolve, got: ${resolvedAt.error}`);
assert.deepEqual(resolvedAt.shape, { type: "string" });

// payload resolves to an object.
const payload = resolveRefShape(flow, "webhook-wait_pbfs1v.output.payload", catalog);
assert.equal(payload.ok, true, `output.payload should resolve, got: ${payload.error}`);
assert.deepEqual(payload.shape, { type: "object", fields: {} });

// Declared output resolves with its declared type.
const declared = resolveRefShape(flow, "webhook-wait_pbfs1v.output.issueNumber", catalog);
assert.equal(declared.ok, true, `output.issueNumber should resolve, got: ${declared.error}`);
assert.deepEqual(declared.shape, { type: "number" });

// Unknown output name errors clearly (catches typos).
const bogus = resolveRefShape(flow, "webhook-wait_pbfs1v.output.resolvedAtt", catalog);
assert.equal(bogus.ok, false, "unknown output name should error");
assert.match(bogus.error ?? "", /not declared/, `expected 'not declared' error, got: ${bogus.error}`);

// We no longer emit the old "is not a step" error for pause-node sources.
assert.ok(!/is not a step/.test(bogus.error ?? ""), "should not say 'is not a step'");

console.log("validate-ref-shape.pause-node: ok");
