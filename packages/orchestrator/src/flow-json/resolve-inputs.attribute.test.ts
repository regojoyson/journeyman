import assert from "node:assert/strict";
import { resolveInputs, parseRef } from "./resolve-inputs.ts";

// A ref binding to an attribute rewrites to the nested workflow.input.attributes namespace.
const out = resolveInputs({
  branch: { kind: "ref", ref: "workflow.attribute.branchPrefix" },
  ticket: { kind: "ref", ref: "workflow.input.ticketId" },
  literal: { kind: "literal", value: 7 },
});
assert.equal(out.branch, "${workflow.input.attributes.branchPrefix}");
assert.equal(out.ticket, "${workflow.input.ticketId}");
assert.equal(out.literal, 7);

// parseRef recognises the attribute scope.
const parsed = parseRef("workflow.attribute.branchPrefix");
assert.ok(parsed, "attribute ref should parse");
assert.equal(parsed!.scope, "workflow.attribute");
assert.equal(parsed!.field, "branchPrefix");

console.log("resolve-inputs.attribute: ok");
