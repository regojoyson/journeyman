import assert from "node:assert/strict";
import { test } from "vitest";
import type { WorkflowGraph } from "@journeyman/core";
import { resolveRefShape, type CatalogShapeEntry } from "./validate-ref-shape.ts";

test("resolveRefShape resolves declared attributes and rejects undeclared", () => {
  const flow = {
    schemaVersion: 2,
    nodes: [],
    edges: [],
    attributeDefs: [
      { name: "branchPrefix", type: "string", value: "feature/" },
      { name: "flags", type: "json-object", value: {} },
    ],
  } as unknown as WorkflowGraph;

  const catalog = new Map<string, CatalogShapeEntry>();

  const ok = resolveRefShape(flow, "workflow.attribute.branchPrefix", catalog);
  assert.equal(ok.ok, true, "declared attribute should resolve");
  assert.deepEqual(ok.shape, { type: "string" });

  const missing = resolveRefShape(flow, "workflow.attribute.nope", catalog);
  assert.equal(missing.ok, false, "undeclared attribute should not resolve");
});
