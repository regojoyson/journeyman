import assert from "node:assert/strict";
import type { WorkflowAttributeDef } from "./flow.types.ts";
import { workflowAttributeDefShape } from "./flow.types.ts";
import { test } from "vitest";

test("flow-attribute-def (assertions)", () => {
  const cases: Array<[WorkflowAttributeDef["type"], unknown]> = [
    ["string", { type: "string" }],
    ["number", { type: "number" }],
    ["boolean", { type: "boolean" }],
    ["json-object", { type: "json", container: "object" }],
    ["json-array", { type: "json", container: "array" }],
  ];

  for (const [type, expected] of cases) {
    const def: WorkflowAttributeDef = { name: "x", type, value: null };
    assert.deepEqual(workflowAttributeDefShape(def), expected, `shape for ${type}`);
  }
});
