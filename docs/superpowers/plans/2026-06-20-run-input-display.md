# Run Input Display in List Tables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show run inputs in the first column of both the workflow runs list ("Ref" column) and the agent runs list (sub-lines under agent name), using a key-as-label / value-prominent two-line layout.

**Architecture:** Change `refLabel()` in `packages/runs-list` to return a structured `RefLabel | null` instead of `{ text, title }`. Export the helper from the package index so `packages/web` can import it for the agent runs table. Update both table components to render the two-line layout.

**Tech Stack:** React, TypeScript, CSS (custom properties), Vitest

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `packages/runs-list/package.json` | Modify | Add vitest dev dep + test script |
| `packages/runs-list/src/ref-label.ts` | Modify | New `RefLabel` type + `refLabel()` returning `RefLabel \| null` |
| `packages/runs-list/src/ref-label.test.ts` | Modify | Update assertions for new shape |
| `packages/runs-list/src/index.ts` | Modify | Export `RefLabel` type and `refLabel` function |
| `packages/runs-list/src/styles.css` | Modify | Add `.je-ref__key`, `.je-ref__val`, `.je-ref__empty` |
| `packages/runs-list/src/RunsList.tsx` | Modify | Two-line Ref cell using CSS classes |
| `packages/web/src/components/agents/AgentRunsList.tsx` | Modify | Sub-lines under agent name using imported `refLabel` |

---

## Task 1: Wire vitest into runs-list + rewrite tests

The test file `ref-label.test.ts` already imports from vitest but neither `vitest` nor a `test` script exist in `package.json`. Add them, then rewrite the tests to assert the new `RefLabel | null` shape. Writing the tests first lets you see them fail before touching the implementation.

**Files:**
- Modify: `packages/runs-list/package.json`
- Modify: `packages/runs-list/src/ref-label.test.ts`

- [ ] **Step 1: Add vitest to runs-list package.json**

Open `packages/runs-list/package.json` and apply these two changes:

```json
{
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "devDependencies": {
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
  }
}
```

Then install:

```bash
npm install
```

- [ ] **Step 2: Rewrite ref-label.test.ts**

Replace the entire file with:

```ts
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
```

- [ ] **Step 3: Run tests — expect failure**

```bash
npm test -w @journeyman/runs-list
```

Expected: test fails because `refLabel` still returns `{ text, title }` instead of `RefLabel | null`. The null assertions and `keyLabel`/`valueText` assertions will fail.

---

## Task 2: Implement the new `refLabel()` in ref-label.ts

Replace the function and add the `RefLabel` interface. Keep `formatValue()` unchanged — it's still used.

**Files:**
- Modify: `packages/runs-list/src/ref-label.ts`

- [ ] **Step 1: Replace ref-label.ts**

```ts
/** Max characters for a single input value before it is clamped. */
const VALUE_MAX = 40;

export interface RefLabel {
  /** Input keys joined with " · ": "branch" or "repo · branch" */
  keyLabel: string;
  /** Formatted values joined with " · ": "main" or "acme/api · main" */
  valueText: string;
  /** Full tooltip text: "repo: acme/api · branch: main". Each value passes through
   *  formatValue() (40-char cap) but the total string has no additional length cap. */
  full: string;
}

/**
 * Format a single input value as a clean one-line string.
 * Primitives render bare (no quotes); objects/arrays render as compact JSON.
 * Clamped to VALUE_MAX chars. Unserializable values fall back to "…".
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
 * Format workflow/agent run inputs as a structured label for the list table.
 * Returns null when inputs are absent, empty, or entirely null/undefined —
 * callers render their own fallback (dash or nothing).
 */
export function refLabel(inputs: Record<string, unknown> | undefined): RefLabel | null {
  if (!inputs) return null;
  const keys: string[] = [];
  const vals: string[] = [];
  const fullPairs: string[] = [];
  for (const [k, v] of Object.entries(inputs)) {
    if (v == null) continue;
    const fv = formatValue(v);
    keys.push(k);
    vals.push(fv);
    fullPairs.push(`${k}: ${fv}`);
  }
  if (keys.length === 0) return null;
  return {
    keyLabel: keys.join(" · "),
    valueText: vals.join(" · "),
    full: fullPairs.join(" · "),
  };
}
```

- [ ] **Step 2: Run tests — expect pass**

```bash
npm test -w @journeyman/runs-list
```

Expected: all assertions pass.

---

## Task 3: Export `RefLabel` and `refLabel` from the package index

`packages/web` needs to import `refLabel` from `@journeyman/runs-list`. Add the exports.

**Files:**
- Modify: `packages/runs-list/src/index.ts`

- [ ] **Step 1: Add exports**

Replace the contents of `packages/runs-list/src/index.ts` with:

```ts
export { WorkflowInstancesList } from "./RunsList.tsx";
export { WorkflowInstanceFilters } from "./RunFilters.tsx";
export { ProviderBadge } from "./ProviderBadge.tsx";
export { Pagination } from "./Pagination.tsx";
export type { PaginationProps } from "./Pagination.tsx";
export type { WorkflowInstancesListProps, WorkflowInstanceFilter } from "./types.ts";
export { refLabel, formatValue } from "./ref-label.ts";
export type { RefLabel } from "./ref-label.ts";
```

---

## Task 4: Add CSS classes and update the workflow runs table

Add the three CSS classes used by the new Ref cell, then update `RunsList.tsx` to render the two-line layout.

**Files:**
- Modify: `packages/runs-list/src/styles.css`
- Modify: `packages/runs-list/src/RunsList.tsx`

- [ ] **Step 1: Add CSS to styles.css**

Append to the end of `packages/runs-list/src/styles.css`:

```css
/* Ref column: key-as-label above, value prominent below */
.je-ref__key { font-size: 10px; color: rgb(var(--color-text-muted) / 1); font-family: ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.04em; }
.je-ref__val { font-size: 13px; color: rgb(var(--color-text) / 1); font-family: ui-monospace, monospace; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.je-ref__empty { color: rgb(var(--color-text-muted) / 1); font-style: italic; font-size: 12px; }
```

- [ ] **Step 2: Update the Ref cell in RunsList.tsx**

In `packages/runs-list/src/RunsList.tsx`, the `const ref = refLabel(r.inputs)` call on line 76 does not change — TypeScript infers the new `RefLabel | null` type automatically.

Find the Ref `<td>` (the one with the monospace inline style, around lines 89–94) and replace it with the two-line cell:

```tsx
<td title={ref?.full}>
  {ref ? (
    <>
      <div className="je-ref__key">{ref.keyLabel}</div>
      <div className="je-ref__val">{ref.valueText}</div>
    </>
  ) : (
    <span className="je-ref__empty">—</span>
  )}
</td>
```

Note: after Task 2 changes `refLabel()`'s return type, `RunsList.tsx` will have TypeScript errors on `ref.title` and `ref.text` until this step is applied. That's expected — typecheck only runs at the end.

---

## Task 5: Update agent runs table — sub-lines under agent name

Import `refLabel` from `@journeyman/runs-list` and render the key/value lines under the agent name. The map arrow must switch from implicit to block form to compute `refLabel` per row.

**Files:**
- Modify: `packages/web/src/components/agents/AgentRunsList.tsx`

- [ ] **Step 1: Add the import**

At the top of `packages/web/src/components/agents/AgentRunsList.tsx`, add after the existing imports:

```ts
import { refLabel } from "@journeyman/runs-list";
```

- [ ] **Step 2: Switch map to block form and update the Agent cell**

Find the `{p.runs.map(r => (` block (around line 133). Change the arrow from implicit return to block form and update the first `<td>`:

```tsx
{p.runs.map(r => {
  const agentRef = refLabel(r.inputs);
  return (
    <tr
      key={r.id}
      onClick={() => p.onSelectRun(r.id)}
      style={{ borderBottom: "1px solid rgb(var(--color-border) / 1)", cursor: "pointer" }}
      onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = "rgb(var(--color-surface-hover) / 1)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = ""; }}
    >
      <td style={{ padding: "10px 6px" }} title={agentRef?.full}>
        <div style={{ fontWeight: 500 }}>{r.agentName}</div>
        {agentRef && (
          <>
            <div style={{ fontSize: 10, color: "rgb(var(--color-text-subtle) / 1)", fontFamily: "ui-monospace, monospace", textTransform: "uppercase", letterSpacing: ".04em", marginTop: 2 }}>
              {agentRef.keyLabel}
            </div>
            <div style={{ fontSize: 11, color: "rgb(var(--color-text-subtle) / 1)", fontFamily: "ui-monospace, monospace", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {agentRef.valueText}
            </div>
          </>
        )}
      </td>
      <td style={{ padding: "10px 6px" }}><StatusPill status={r.status} /></td>
      <td style={{ padding: "10px 6px", color: "rgb(var(--color-text-subtle) / 1)" }}>{r.triggerSource}</td>
      <td style={{ padding: "10px 6px", color: "rgb(var(--color-text-subtle) / 1)" }}>{fmtRelative(r.startedAt)}</td>
      <td style={{ padding: "10px 6px", color: "rgb(var(--color-text-subtle) / 1)" }}>
        {r.status === "running"
          ? `${formatDuration(r.startedAt ? Date.now() - new Date(r.startedAt).getTime() : null)}…`
          : formatDuration(r.durationMs)}
      </td>
      <td style={{ padding: "10px 6px", color: "rgb(var(--color-text-subtle) / 1)", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
        {r.provider}{r.model ? ` · ${r.model}` : ""}
      </td>
      <td style={{ padding: "10px 6px" }}>
        {r.status !== "running" && (
          <button
            type="button"
            className={btnSecondary}
            onClick={e => { e.stopPropagation(); p.onRerun(r); }}
          >
            Re-run
          </button>
        )}
      </td>
    </tr>
  );
})}
```

---

## Task 6: Typecheck

- [ ] **Step 1: Run typecheck across all workspaces**

```bash
npm run typecheck
```

Expected: no errors. Key things the compiler will catch: the `refLabel` return type change (`RefLabel | null` instead of `{ text, title }`), any missed `.text` or `.title` usages from the old shape, and the new import in `AgentRunsList.tsx`.
