import { test } from "node:test";
import assert from "node:assert/strict";
import { findViolations } from "./check-theme-colors.mjs";

test("flags a raw hex color", () => {
  const v = findViolations("a.css", ".x { color: #2a2a3a; }");
  assert.equal(v.length, 1);
  assert.match(v[0], /#2a2a3a/);
});

test("flags non-themeable tailwind classes", () => {
  const v = findViolations("a.tsx", '<div className="bg-black bg-slate-950 text-slate-50 bg-white" />');
  assert.equal(v.length, 4);
});

test("does NOT flag text-white or shadow-* (theme-safe / color-agnostic)", () => {
  const v = findViolations("a.tsx", '<button className="bg-accent text-white shadow-black shadow-2xl" />');
  assert.equal(v.length, 0);
});

test("does NOT flag themed var() usage", () => {
  const v = findViolations("a.css", ".x { color: rgb(var(--color-text) / 1); }");
  assert.equal(v.length, 0);
});

test("does NOT flag remapped slate shades 100-900 or accent classes", () => {
  const v = findViolations("a.tsx", '<div className="bg-slate-900 text-slate-400 bg-accent text-default" />');
  assert.equal(v.length, 0);
});

test("respects an inline allow comment", () => {
  const v = findViolations("a.tsx", '<button className="bg-accent text-white" /> /* theme-colors-allow: white-on-accent */');
  assert.equal(v.length, 0);
});
