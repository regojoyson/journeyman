import assert from "node:assert/strict";
import { formatValue, refLabel } from "./ref-label.ts";
import { test } from "vitest";

test("ref-label (assertions)", () => {
  // --- formatValue: primitives render bare ---
  assert.equal(formatValue("github:owner/repo#5"), "github:owner/repo#5");
  assert.equal(formatValue(42), "42");
  assert.equal(formatValue(true), "true");

  // --- formatValue: objects/arrays as compact JSON ---
  assert.equal(formatValue({ id: 42 }), '{"id":42}');
  assert.equal(formatValue(["bug", "p1"]), '["bug","p1"]');

  // --- formatValue: per-value clamp at 40 chars with ellipsis ---
  const long = "x".repeat(50);
  const fv = formatValue(long);
  assert.equal(fv.length, 40);
  assert.ok(fv.endsWith("…"));

  // --- formatValue: unserializable value falls back to "…" ---
  const circular: any = {};
  circular.self = circular;
  assert.equal(formatValue(circular), "…");

  // --- refLabel: undefined / empty / all-null => null ---
  assert.equal(refLabel(undefined), null);
  assert.equal(refLabel({}), null);
  assert.equal(refLabel({ a: null, b: undefined }), null);

  // --- refLabel: single input ---
  assert.deepEqual(refLabel({ branch: "main" }), {
    keyLabel: "branch",
    valueText: "main",
    full: "branch: main",
  });

  // --- refLabel: multiple inputs joined with " · " ---
  assert.deepEqual(refLabel({ repo: "acme/api", branch: "main" }), {
    keyLabel: "repo · branch",
    valueText: "acme/api · main",
    full: "repo: acme/api · branch: main",
  });

  // --- refLabel: string key ---
  assert.deepEqual(refLabel({ issueRef: "github:owner/repo#5" }), {
    keyLabel: "issueRef",
    valueText: "github:owner/repo#5",
    full: "issueRef: github:owner/repo#5",
  });

  // --- refLabel: object/array values go through formatValue ---
  const r1 = refLabel({ labels: ["bug", "p1"] });
  assert.equal(r1!.valueText, '["bug","p1"]');
  assert.equal(r1!.full, 'labels: ["bug","p1"]');

  const r2 = refLabel({ payload: { id: 42 } });
  assert.equal(r2!.valueText, '{"id":42}');

  // --- refLabel: long value clamped at 40 chars by formatValue ---
  const big = "y".repeat(80);
  const r3 = refLabel({ big, severity: "high" });
  assert.equal(r3!.keyLabel, "big · severity");
  assert.equal(r3!.valueText, "y".repeat(39) + "… · high");
  assert.ok(r3!.full.includes("severity: high"));
  assert.ok(r3!.full.includes("big: " + "y".repeat(39) + "…"));
});
