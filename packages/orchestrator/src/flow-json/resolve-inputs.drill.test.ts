import assert from "node:assert/strict";
import { test } from "vitest";
import { resolveInputs, toEngineRef, sanitizeRef } from "./resolve-inputs.ts";

test("brackets and dots survive sanitizeRef", () => {
  assert.equal(sanitizeRef("list.output.pullRequests[0].title"), "list.output.pullRequests[0].title");
  assert.equal(sanitizeRef("list.output.items[*].title"), "list.output.items[*].title");
  assert.equal(sanitizeRef("wh.output.payload.user.name"), "wh.output.payload.user.name");
});

test("toEngineRef preserves the drilled tail verbatim", () => {
  assert.equal(toEngineRef("list.output.pullRequests[0].title"), "list.output.pullRequests[0].title");
  assert.equal(toEngineRef("workflow.attribute.payload[*].id"), "workflow.input.attributes.payload[*].id");
});

test("resolveInputs wraps drilled refs as ${...}", () => {
  const out = resolveInputs({
    a: { kind: "ref", ref: "list.output.pullRequests[0].title" },
    b: { kind: "template", template: "branch-${list.output.items[*].title}" },
  });
  assert.equal(out.a, "${list.output.pullRequests[0].title}");
  assert.equal(out.b, "branch-${list.output.items[*].title}");
});
