import assert from "node:assert/strict";
import { formatValue, refLabel } from "./ref-label.ts";

// --- formatValue: primitives render bare (no quotes) ---
assert.equal(formatValue("github:owner/repo#5"), "github:owner/repo#5");
assert.equal(formatValue(42), "42");
assert.equal(formatValue(true), "true");

// --- formatValue: objects/arrays render as compact JSON ---
assert.equal(formatValue({ id: 42 }), '{"id":42}');
assert.equal(formatValue(["bug", "p1"]), '["bug","p1"]');

// --- formatValue: per-value clamp at 40 chars with ellipsis ---
const long = "x".repeat(50);
const fv = formatValue(long);
assert.equal(fv.length, 40);          // 39 chars + "…"
assert.ok(fv.endsWith("…"));

// --- formatValue: unserializable value falls back to "…" ---
const circular: any = {};
circular.self = circular;
assert.equal(formatValue(circular), "…");

// --- refLabel: undefined / empty / all-null inputs => dash ---
assert.equal(refLabel(undefined).text, "—");
assert.equal(refLabel({}).text, "—");
assert.equal(refLabel({ a: null, b: undefined }).text, "—");

// --- refLabel: flat primitives unchanged from old behavior ---
assert.deepEqual(refLabel({ issueRef: "github:owner/repo#5" }), {
  text: "issueRef=github:owner/repo#5",
  title: "issueRef=github:owner/repo#5",
});

// --- refLabel: object/array values are now rendered, not dropped ---
assert.equal(refLabel({ labels: ["bug", "p1"] }).text, 'labels=["bug","p1"]');
assert.equal(refLabel({ payload: { id: 42 } }).text, 'payload={"id":42}');

// --- refLabel: mixed primitives + objects keep every key ---
{
  const r = refLabel({ issueRef: "abc", meta: { x: 1 } });
  assert.ok(r.text.includes("issueRef=abc"));
  assert.ok(r.text.includes('meta={"x":1}'));
}

// --- refLabel: one oversized value does not crowd out other keys ---
{
  const r = refLabel({ big: "y".repeat(80), severity: "high" });
  // per-value clamp keeps "big" short enough that "severity" still appears
  // in the full (title) string
  assert.ok(r.title!.includes("severity=high"));
  assert.ok(r.title!.includes("big=" + "y".repeat(39) + "…"));
}

// --- refLabel: visible text clamped to 60 chars, full text in title ---
{
  const r = refLabel({ a: "12345678901234567890", b: "12345678901234567890", c: "12345678901234567890", d: "12345678901234567890" });
  assert.ok(r.text.length <= 60);
  assert.ok(r.title!.length > r.text.length);
  assert.ok(r.text.endsWith("…"));
}

console.log("ref-label: ok");
