import assert from "node:assert/strict";
import type { Shape, WorkflowInputValue } from "@journeyman/core";
import {
  modeForValue, widgetForShape, jsonContainerForShape,
  refSegmentsToInput, refWithPathSegmentsToInput, valueSegmentsToInput,
  inputToValueSegments, inputToRefSegments,
  parseJsonLiteral, jsonLiteralToText,
  numberLiteralValue, booleanLiteralValue,
} from "./input-value-serialize.ts";
import { test } from "vitest";

test("input-value-serialize (assertions)", () => {
  // modeForValue
  assert.equal(modeForValue(undefined), "reference");
  assert.equal(modeForValue({ kind: "ref", ref: "a.output.x" }), "reference");
  assert.equal(modeForValue({ kind: "literal", value: 1 }), "value");
  assert.equal(modeForValue({ kind: "template", template: "x${a.output.y}" }), "value");

  // widgetForShape
  assert.equal(widgetForShape(undefined), "string");
  assert.equal(widgetForShape({ type: "string" }), "string");
  assert.equal(widgetForShape({ type: "number" }), "number");
  assert.equal(widgetForShape({ type: "boolean" }), "boolean");
  assert.equal(widgetForShape({ type: "json", container: "object" }), "json");
  assert.equal(widgetForShape({ type: "json", container: "array" }), "json");
  assert.equal(widgetForShape({ type: "array", items: { type: "string" } }), "json");
  assert.equal(widgetForShape({ type: "object", fields: {} }), "json");

  // jsonContainerForShape
  assert.equal(jsonContainerForShape({ type: "json", container: "array" }), "array");
  assert.equal(jsonContainerForShape({ type: "array", items: { type: "string" } }), "array");
  assert.equal(jsonContainerForShape({ type: "json", container: "object" }), "object");
  assert.equal(jsonContainerForShape(undefined), "object");

  // refSegmentsToInput
  assert.deepEqual(refSegmentsToInput([{ kind: "ref", ref: "a.output.x" }]), { kind: "ref", ref: "a.output.x" });
  assert.equal(refSegmentsToInput([]), undefined);
  assert.equal(refSegmentsToInput([{ kind: "text", text: "hi" }]), undefined);

  // refWithPathSegmentsToInput — single-field reference + inline path tail
  assert.deepEqual(
    refWithPathSegmentsToInput([{ kind: "ref", ref: "list.output.prs" }, { kind: "text", text: "[0].title" }]),
    { kind: "ref", ref: "list.output.prs[0].title" },
  );
  assert.deepEqual(
    refWithPathSegmentsToInput([{ kind: "ref", ref: "wh.output.payload" }]),
    { kind: "ref", ref: "wh.output.payload" },
  );
  assert.equal(refWithPathSegmentsToInput([{ kind: "text", text: "no ref" }]), undefined);

  // valueSegmentsToInput (string Value mode)
  assert.deepEqual(valueSegmentsToInput([{ kind: "text", text: "hello" }]), { kind: "literal", value: "hello" });
  assert.deepEqual(valueSegmentsToInput([{ kind: "ref", ref: "a.output.x" }]), { kind: "ref", ref: "a.output.x" });
  assert.deepEqual(
    valueSegmentsToInput([{ kind: "text", text: "PR-" }, { kind: "ref", ref: "a.output.id" }]),
    { kind: "template", template: "PR-${a.output.id}" },
  );
  assert.equal(valueSegmentsToInput([]), undefined);
  assert.equal(valueSegmentsToInput([{ kind: "text", text: "" }]), undefined);

  // inputToValueSegments
  assert.deepEqual(inputToValueSegments(undefined), []);
  assert.deepEqual(inputToValueSegments({ kind: "ref", ref: "a.output.x" }), [{ kind: "ref", ref: "a.output.x" }]);
  assert.deepEqual(inputToValueSegments({ kind: "template", template: "PR-${a.output.id}" }), [
    { kind: "text", text: "PR-" }, { kind: "ref", ref: "a.output.id" },
  ]);
  assert.deepEqual(inputToValueSegments({ kind: "literal", value: "hi" }), [{ kind: "text", text: "hi" }]);
  assert.deepEqual(inputToValueSegments({ kind: "literal", value: 5 } as WorkflowInputValue), []);

  // inputToRefSegments
  assert.deepEqual(inputToRefSegments({ kind: "ref", ref: "a.output.x" }), [{ kind: "ref", ref: "a.output.x" }]);
  assert.deepEqual(inputToRefSegments({ kind: "literal", value: "hi" }), []);

  // parseJsonLiteral
  assert.deepEqual(parseJsonLiteral('{"a":1}', "object"), { ok: true, value: { a: 1 } });
  assert.deepEqual(parseJsonLiteral("[1,2]", "array"), { ok: true, value: [1, 2] });
  assert.equal(parseJsonLiteral("[1,2]", "object").ok, false);   // array in object slot
  assert.equal(parseJsonLiteral('{"a":1}', "array").ok, false);  // object in array slot
  assert.equal(parseJsonLiteral("not json", "object").ok, false);
  assert.equal(parseJsonLiteral("", "object").ok, false);
  assert.equal(parseJsonLiteral("null", "object").ok, false);

  // jsonLiteralToText
  assert.equal(jsonLiteralToText({ kind: "literal", value: { a: 1 } }), JSON.stringify({ a: 1 }, null, 2));
  assert.equal(jsonLiteralToText(undefined), "");
  assert.equal(jsonLiteralToText({ kind: "ref", ref: "a.output.x" }), "");

  // numberLiteralValue / booleanLiteralValue
  assert.equal(numberLiteralValue({ kind: "literal", value: 42 }), 42);
  assert.equal(numberLiteralValue({ kind: "literal", value: "x" } as WorkflowInputValue), undefined);
  assert.equal(booleanLiteralValue({ kind: "literal", value: true }), true);
  assert.equal(booleanLiteralValue({ kind: "literal", value: false }), false);
  assert.equal(booleanLiteralValue(undefined), undefined);

  // silence unused Shape import lint in case the runner is strict
  const _s: Shape = { type: "string" }; void _s;
});
