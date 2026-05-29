# Workflow Instance Ref Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Workflow Instances "Ref" column render *all* inputs a run carries — including object/array values — instead of silently dropping non-primitives, without affecting table layout.

**Architecture:** Front-end only. Refactor the existing `refLabel()` in `packages/runs-list/src/RunsList.tsx` into two exported pure functions (`formatValue` + `refLabel`), add type-aware formatting for objects/arrays plus a per-value length clamp, and cover them with a `node:assert` unit test. No type, API, or DB changes — the run's `inputs` field is already fetched and returned.

**Tech Stack:** TypeScript, React 18, `node:assert/strict` tests run via `tsx` (repo convention, see `packages/api-server/src/services/listens-for.test.ts`).

---

## File Structure

- `packages/runs-list/src/RunsList.tsx` — currently defines `refLabel()` as a non-exported local helper that skips non-primitive values (lines 14–27). We will: add an exported `formatValue()`, rewrite and **export** `refLabel()`, and leave the React component using it exactly as today (`const ref = refLabel(r.inputs)` on line 95). Exporting the two pure helpers is required so the test file can import them; it does not change the public package surface (`src/index.ts` only re-exports the component).
- `packages/runs-list/src/ref-label.test.ts` — **new** co-located test for the two pure helpers, following the `node:assert/strict` + `console.log("…: ok")` convention used elsewhere in the repo.

The cell's overflow safety is already guaranteed by existing CSS on the `<td>` (`maxWidth: 200`, `whiteSpace: nowrap`, `overflow: hidden`, `textOverflow: ellipsis`) plus the 60-char visible clamp in `refLabel()`. We preserve both — no CSS changes.

---

### Task 1: Add `formatValue()` and rewrite `refLabel()` to render all input values

**Files:**
- Modify: `packages/runs-list/src/RunsList.tsx:9-27` (the doc comment + `refLabel` function)
- Test: `packages/runs-list/src/ref-label.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/runs-list/src/ref-label.test.ts` with the full content below. It imports the two pure helpers that Task 1 will export from `RunsList.tsx`.

```ts
import assert from "node:assert/strict";
import { formatValue, refLabel } from "./RunsList.tsx";

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
  const r = refLabel({ a: "1234567890", b: "1234567890", c: "1234567890", d: "1234567890" });
  assert.ok(r.text.length <= 60);
  assert.ok(r.title!.length > r.text.length);
  assert.ok(r.text.endsWith("…"));
}

console.log("ref-label: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/admin/data/workspace/claude-skils/journeyman && npx tsx packages/runs-list/src/ref-label.test.ts`
Expected: FAIL — import error / `formatValue is not a function` (and `refLabel` not exported), because the helpers are not yet exported and `formatValue` does not exist.

- [ ] **Step 3: Write the implementation**

In `packages/runs-list/src/RunsList.tsx`, replace the existing doc comment + `refLabel` function (lines 9–27) with the following. Note `formatValue` is added and **both** functions are now `export`ed. The component call site on line 95 (`const ref = refLabel(r.inputs);`) is unchanged.

```ts
/** Max characters for a single input value before it is clamped (so one large
 *  value cannot crowd the others out of the Ref column). */
const VALUE_MAX = 40;
/** Max characters for the whole visible Ref string. Full text goes in the tooltip. */
const LABEL_MAX = 60;

/**
 * Format a single input value as a clean one-line string for the Ref column.
 * Primitives render bare (no quotes); objects/arrays render as compact JSON.
 * The result is clamped to VALUE_MAX chars. Unserializable values fall back to "…".
 */
export function formatValue(v: unknown): string {
  let s: string;
  if (typeof v === "string") {
    s = v;
  } else if (typeof v === "number" || typeof v === "boolean") {
    s = String(v);
  } else {
    try {
      s = JSON.stringify(v);
    } catch {
      return "…";
    }
    if (s === undefined) return "…";
  }
  return s.length > VALUE_MAX ? s.slice(0, VALUE_MAX - 1) + "…" : s;
}

/**
 * Render the workflow inputs as a short "key=value, key=value" summary for the
 * leftmost column. All non-null values are rendered (objects/arrays as compact
 * JSON). Each value is clamped individually; the full joined string goes in the
 * tooltip and the visible string is clamped to LABEL_MAX.
 */
export function refLabel(inputs: Record<string, unknown> | undefined): { text: string; title?: string } {
  if (!inputs) return { text: "—" };
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(inputs)) {
    if (v == null) continue;
    pairs.push(`${k}=${formatValue(v)}`);
  }
  if (pairs.length === 0) return { text: "—" };
  const full = pairs.join(", ");
  const text = full.length > LABEL_MAX ? full.slice(0, LABEL_MAX - 3) + "…" : full;
  return { text, title: full };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/admin/data/workspace/claude-skils/journeyman && npx tsx packages/runs-list/src/ref-label.test.ts`
Expected: PASS — prints `ref-label: ok`.

- [ ] **Step 5: Typecheck the package**

Run: `npm run typecheck -w @journeyman/runs-list`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/runs-list/src/RunsList.tsx packages/runs-list/src/ref-label.test.ts
git commit -m "feat(runs-list): render object/array inputs in workflow instance Ref column"
```

---

## Self-Review

**Spec coverage:**
- "Make `refLabel()` render non-primitive values" → Task 1, Step 3 (`formatValue` handles object/array; `refLabel` no longer filters by type).
- "type-aware `formatValue(v)` helper" with string/number/boolean/object/array/null table → Task 1, Step 3 + tests in Step 1.
- "Per-value clamp ~40 chars before joining" → `VALUE_MAX = 40` + clamp in `formatValue`; tested ("oversized value does not crowd out other keys").
- "Keep overall 60-char clamp + full tooltip" → `LABEL_MAX = 60` + `title: full`; tested.
- "try/catch fallback for unserializable" → `formatValue` catch → `"…"`; tested with circular ref.
- "Empty inputs still show –" → unchanged early returns; tested (`undefined`, `{}`, all-null).
- "Front-end only, single file (+ test)" → only `RunsList.tsx` modified, `ref-label.test.ts` added. No types/API/DB touched.

**Placeholder scan:** None — all steps contain runnable commands and complete code.

**Type consistency:** `formatValue(v: unknown): string` and `refLabel(inputs): { text: string; title?: string }` are used identically in the test and at the existing call site (`r.inputs` is `Record<string, unknown>`). The `{ text, title }` shape matches the existing `<td title={ref.title}>{ref.text}</td>` usage (RunsList.tsx lines 108–113), so no call-site change is needed.
