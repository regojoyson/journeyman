import assert from "node:assert/strict";
import { parseTemplate, segmentsToTemplate, soleRefOf, type Segment } from "./mention-serialize.ts";

// parseTemplate: plain text
assert.deepEqual(parseTemplate("hello"), [{ kind: "text", text: "hello" }]);

// parseTemplate: single ref only
assert.deepEqual(parseTemplate("${a.output.x}"), [{ kind: "ref", ref: "a.output.x" }]);

// parseTemplate: text + ref + text
assert.deepEqual(parseTemplate("feature/${a.output.x}-done"), [
  { kind: "text", text: "feature/" },
  { kind: "ref", ref: "a.output.x" },
  { kind: "text", text: "-done" },
]);

// parseTemplate: two refs
assert.deepEqual(parseTemplate("${a.output.x}${b.input.y}"), [
  { kind: "ref", ref: "a.output.x" },
  { kind: "ref", ref: "b.input.y" },
]);

// parseTemplate: empty string
assert.deepEqual(parseTemplate(""), []);

// segmentsToTemplate: round-trips
const segs: Segment[] = [
  { kind: "text", text: "feature/" },
  { kind: "ref", ref: "a.output.x" },
];
assert.equal(segmentsToTemplate(segs), "feature/${a.output.x}");
assert.equal(segmentsToTemplate([]), "");

// soleRefOf: exactly one ref, no text → the ref
assert.equal(soleRefOf([{ kind: "ref", ref: "a.output.x" }]), "a.output.x");

// soleRefOf: ref with surrounding whitespace-only text → still sole
assert.equal(soleRefOf([
  { kind: "text", text: "  " },
  { kind: "ref", ref: "a.output.x" },
]), "a.output.x");

// soleRefOf: ref + real text → null
assert.equal(soleRefOf([
  { kind: "text", text: "feature/" },
  { kind: "ref", ref: "a.output.x" },
]), null);

// soleRefOf: two refs → null
assert.equal(soleRefOf([
  { kind: "ref", ref: "a.output.x" },
  { kind: "ref", ref: "b.input.y" },
]), null);

// soleRefOf: no refs → null
assert.equal(soleRefOf([{ kind: "text", text: "hi" }]), null);

// --- braces syntax ({{ref}}) ---
assert.deepEqual(parseTemplate("hi {{a.output.x}}!", "braces"), [
  { kind: "text", text: "hi " },
  { kind: "ref", ref: "a.output.x" },
  { kind: "text", text: "!" },
]);
assert.deepEqual(parseTemplate("${a.output.x}", "braces"), [
  { kind: "text", text: "${a.output.x}" },
]); // dollar form is plain text under braces syntax
assert.equal(
  segmentsToTemplate([
    { kind: "text", text: "hi " },
    { kind: "ref", ref: "a.output.x" },
  ], "braces"),
  "hi {{a.output.x}}",
);

console.log("mention-serialize: ok");
