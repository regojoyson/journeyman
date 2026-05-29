import assert from "node:assert/strict";
import type { WorkflowAttributeDef } from "@journeyman/core";
import { buildAttributeInputs } from "./attribute-inputs.ts";

const defs: WorkflowAttributeDef[] = [
  { name: "branchPrefix", type: "string", value: "feature/" },
  { name: "maxRetries", type: "number", value: 3 },
  { name: "flags", type: "json-object", value: { a: 1 } },
];

assert.deepEqual(buildAttributeInputs(defs), {
  branchPrefix: "feature/",
  maxRetries: 3,
  flags: { a: 1 },
});

// undefined / empty → empty object (never undefined)
assert.deepEqual(buildAttributeInputs(undefined), {});
assert.deepEqual(buildAttributeInputs([]), {});

// later def with duplicate name wins (defensive; editor blocks dupes)
assert.deepEqual(
  buildAttributeInputs([
    { name: "x", type: "string", value: "a" },
    { name: "x", type: "string", value: "b" },
  ]),
  { x: "b" },
);

console.log("attribute-inputs: ok");
