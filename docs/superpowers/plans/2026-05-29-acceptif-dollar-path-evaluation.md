# Make the Condition Evaluator `$.`-Path Aware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the shared JSONLogic condition evaluator to resolve `var` paths using the project's `$.`/`[n]` standard, so webhook "Accept if" conditions built from `$.`-prefixed path suggestions evaluate correctly.

**Architecture:** Add two pure helpers in the evaluator module — `normalizeVarPath` (strip leading `$.`/`$`, convert `[n]` → `.n`) and `normalizeVarsInExpr` (recursively rewrite every `{ var: string }` in a JSONLogic tree) — and run the expression through `normalizeVarsInExpr` before `jsonLogic.apply`. No global json-logic mutation; clean paths still work; only the evaluator changes.

**Tech Stack:** TypeScript (ESM, `.ts` import extensions), `json-logic-js`. Tests are assert-based `.test.ts` files run with `npx tsx <file>`.

**User constraints (override skill defaults):**
- **Do NOT commit** at any point. No `git commit` steps.
- **Run `npm run typecheck` at the very end** (final task) as the completion gate.

**Spec:** `docs/superpowers/specs/2026-05-29-acceptif-dollar-path-evaluation-design.md`

**Verified facts:**
- The evaluator is the whole of `packages/orchestrator/src/conditions/jsonlogic-evaluator.ts` (9 lines; uses `json-logic-js`'s `jsonLogic.apply`).
- `conditions.evaluate` is used only for acceptIf (2 call sites); changing the evaluator is the single fix point.
- `json-logic-js`'s `var` splits the path on `.` and indexes arrays via the numeric-string key (`data["0"]` works for JS arrays), so converting `[n]` → `.n` is sufficient.
- The real `issues` sample payload has `labels: [{ name: "bug" }]`, so `$.labels[0].name` is a valid array test.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/orchestrator/src/conditions/jsonlogic-evaluator.ts` | `normalizeVarPath`, `normalizeVarsInExpr`, `$.`-aware `evaluate` | Modify |
| `packages/orchestrator/src/conditions/jsonlogic-evaluator.test.ts` | Unit tests (path normalize + evaluation vs. sample payload) | Create |
| `packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx` | Standardize the JSON-mode placeholder + field hint on `$.` | Modify |

---

## Task 1: `$.`-aware path normalization in the evaluator

**Files:**
- Modify: `packages/orchestrator/src/conditions/jsonlogic-evaluator.ts`
- Test: `packages/orchestrator/src/conditions/jsonlogic-evaluator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/conditions/jsonlogic-evaluator.test.ts`:

```ts
import assert from "node:assert/strict";
import { JsonLogicEvaluator, normalizeVarPath } from "./jsonlogic-evaluator.ts";

// --- normalizeVarPath ---
assert.equal(normalizeVarPath("$.issue.state"), "issue.state");
assert.equal(normalizeVarPath("issue.state"), "issue.state");
assert.equal(normalizeVarPath("$.labels[0].name"), "labels.0.name");
assert.equal(normalizeVarPath("$"), "");
assert.equal(normalizeVarPath("  $.a.b  "), "a.b");

// --- evaluation against the real `issues` sample payload ---
const ev = new JsonLogicEvaluator();
const payload = {
  action: "opened",
  issue: { number: 7, title: "Bug", state: "open", user: { login: "alice" } },
  repository: { full_name: "acme/demo" },
  sender: { login: "alice" },
  labels: [{ name: "bug" }],
};

// $.-prefixed paths now resolve
assert.equal(ev.evaluate({ "==": [{ var: "$.issue.state" }, "open"] }, payload), true);
// plain paths still work (no regression)
assert.equal(ev.evaluate({ "==": [{ var: "issue.state" }, "open"] }, payload), true);
// nested $.
assert.equal(ev.evaluate({ "==": [{ var: "$.issue.user.login" }, "alice"] }, payload), true);
// array indexing
assert.equal(ev.evaluate({ "==": [{ var: "$.labels[0].name" }, "bug"] }, payload), true);
// negation / and
assert.equal(ev.evaluate({ "!=": [{ var: "$.issue.state" }, "closed"] }, payload), true);
assert.equal(ev.evaluate({ and: [
  { "==": [{ var: "$.issue.state" }, "open"] },
  { "==": [{ var: "$.action" }, "opened"] },
] }, payload), true);
// non-matching → false (not a throw)
assert.equal(ev.evaluate({ "==": [{ var: "$.issue.state" }, "closed"] }, payload), false);
// missing path → comparison false, no throw
assert.equal(ev.evaluate({ "==": [{ var: "$.nope.gone" }, "x"] }, payload), false);
// null expression → false
assert.equal(ev.evaluate(null, payload), false);

console.log("jsonlogic-evaluator: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/orchestrator/src/conditions/jsonlogic-evaluator.test.ts`
Expected: FAIL — `normalizeVarPath` is not exported (and `$.`-prefixed assertions would fail against the current evaluator).

- [ ] **Step 3: Implement the helpers and use them in `evaluate`**

Replace the entire contents of `packages/orchestrator/src/conditions/jsonlogic-evaluator.ts` with:

```ts
import jsonLogic from "json-logic-js";
import type { IConditionEvaluator } from "@journeyman/core";

/**
 * Normalize a JSONLogic `var` path to json-logic-js's dot-only form, matching
 * the project's `$.`/`[n]` path standard (same convention as `readPath`):
 *   - trim surrounding whitespace
 *   - strip a leading `$.`; a lone `$` becomes "" (whole-document var)
 *   - convert `[n]` array indexes to `.n` (json-logic indexes arrays by the
 *     numeric-string key, e.g. data["0"])
 */
export function normalizeVarPath(path: string): string {
  let p = path.trim();
  if (p === "$") return "";
  if (p.startsWith("$.")) p = p.slice(2);
  // "labels[0]" → "labels.0"; "a[1][2]" → "a.1.2"
  p = p.replace(/\[(\d+)\]/g, ".$1");
  return p;
}

/**
 * Recursively rewrite every `{ var: <string> }` node in a JSONLogic expression
 * via `normalizeVarPath`. Pure — returns a new tree, never mutates the input.
 */
export function normalizeVarsInExpr(expr: unknown): unknown {
  if (Array.isArray(expr)) return expr.map(normalizeVarsInExpr);
  if (expr && typeof expr === "object") {
    const obj = expr as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === "var" && typeof obj.var === "string") {
      return { var: normalizeVarPath(obj.var) };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = normalizeVarsInExpr(v);
    return out;
  }
  return expr;
}

export class JsonLogicEvaluator implements IConditionEvaluator {
  evaluate(expression: unknown, data: Record<string, unknown>): boolean {
    if (expression == null) return false;
    return Boolean(jsonLogic.apply(normalizeVarsInExpr(expression) as any, data));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx packages/orchestrator/src/conditions/jsonlogic-evaluator.test.ts`
Expected: PASS — prints `jsonlogic-evaluator: ok`.

---

## Task 2: Standardize the AcceptIf UI examples on `$.`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx`

The visual field input (line ~156) and the JSON-mode placeholder (line ~228)
should both present the `$.` form so users only ever see one standard.

- [ ] **Step 1: Update the visual field-input placeholder**

In `packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx`, the visual
rule field input currently uses `placeholder="field path in payload"`. Change it
to show the `$.` form:

```tsx
                  placeholder="$.issue.state"
```

- [ ] **Step 2: Update the JSON-mode placeholder**

Change the advanced (JSON) textarea placeholder (line ~228) from:

```tsx
            placeholder='{"==": [{"var": "issue.fields.status.name"}, "Done"]}'
```

to:

```tsx
            placeholder='{"==": [{"var": "$.issue.fields.status.name"}, "Done"]}'
```

- [ ] **Step 3: Typecheck flow-editor**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS — no type errors.

---

## Task 3: Final verification gate

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck across all workspaces**

Run: `npm run typecheck`
Expected: PASS — no type errors in any workspace.

- [ ] **Step 2: Re-run the evaluator test**

Run: `npx tsx packages/orchestrator/src/conditions/jsonlogic-evaluator.test.ts`
Expected: prints `jsonlogic-evaluator: ok`.

- [ ] **Step 3: Import-boundary check**

Run: `npm run check:boundaries`
Expected: PASS — clean (no new cross-package imports; only `json-logic-js` and `@journeyman/core`, both already used).

> Per user constraint: do **not** commit. Stop here and report results.
>
> Manual re-test (requires restarting the api-server to pick up the change): a
> webhook trigger with Accept-if `$.issue.state == "open"` (picked from the
> suggestions) now fires only when the payload's `issue.state` is `open`.

---

## Self-Review Notes

- **Spec coverage:** `normalizeVarPath` + `normalizeVarsInExpr` + `$.`-aware `evaluate` (Task 1); edge cases (lone `$`, missing path, null expr, arrays, nested and/or) covered in the Task 1 test; UI examples standardized on `$.` (Task 2); verification gate (Task 3). All spec sections mapped.
- **Type consistency:** `normalizeVarPath(string): string` and `normalizeVarsInExpr(unknown): unknown` are defined and exported in Task 1's implementation and imported with the same names/signatures in Task 1's test. `evaluate` keeps its existing `(unknown, Record<string, unknown>) => boolean` signature.
- **Constraints honored:** no `git commit` steps; `npm run typecheck` is the final gate (Task 3).
