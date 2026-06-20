# Run Input Display in List Tables

**Date:** 2026-06-20  
**Scope:** `packages/runs-list`, `packages/web/src/components/agents/AgentRunsList.tsx`

## Problem

Both the workflow runs list and the agent runs list have a first-column "identifier" cell. The workflow runs table shows a "Ref" column that renders inputs as a flat `key=value, key=value` monospace string — hard to scan at a glance. The agent runs table shows only the agent name with no input context at all. Users cannot quickly distinguish one run from another without opening the detail page.

## Design

### Display format

The chosen format shows the **key** as a small uppercase label and the **value** prominently below it. Multiple keys/values are joined with ` · `.

```
BRANCH
feature/123-fix-auth

REPO · BRANCH
acme/api · main
```

When there are no inputs:
- Workflow runs Ref cell: `—` (muted, italic)
- Agent runs Agent cell: nothing — just the agent name, no sub-lines

The full untruncated `key: value · key: value` string is always present as a `title` tooltip.

---

### `refLabel()` — new return type

**File:** `packages/runs-list/src/ref-label.ts`

```ts
export interface RefLabel {
  keyLabel: string;   // keys joined: "branch" or "repo · branch"
  valueText: string;  // values joined: "feature/123" or "acme/api · main"
  full: string;       // tooltip: "repo: acme/api · branch: main" (untruncated)
}

export function refLabel(inputs: Record<string, unknown> | undefined): RefLabel | null
```

Returns `null` when `inputs` is undefined, empty, or all-null — callers use `null` to render the fallback.

Existing `formatValue()` and per-value clamping (40 chars) are unchanged. The `full` tooltip is built as `key: value · key: value` (using `: ` and ` · ` separators) — each value passed through `formatValue()` so individual values are still capped at 40 chars, but the total string has no additional cap. `keyLabel` and `valueText` have no separate string-level cap; the CSS `max-width` + `text-overflow: ellipsis` handles visual truncation, and `title` (set to `full`) provides the complete text on hover.

Both `refLabel` and `RefLabel` are exported from `packages/runs-list/src/index.ts`.

---

### Workflow runs table

**File:** `packages/runs-list/src/RunsList.tsx`

The "Ref" `<td>` is replaced with a two-line cell:

```tsx
const ref = refLabel(r.inputs);
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

CSS in `styles.css`:
- `.je-ref__key` — `font-size: 10px`, uppercase, monospace, muted color (`--color-text-muted`)
- `.je-ref__val` — `font-size: 13px`, monospace, `max-width: 200px`, ellipsis overflow
- `.je-ref__empty` — muted italic, `font-size: 12px`

Column header stays **"Ref"**.

---

### Agent runs table

**File:** `packages/web/src/components/agents/AgentRunsList.tsx`

`refLabel` is imported from `@journeyman/runs-list` (already a dependency of `web`). The "Agent" `<td>` becomes a three-line cell (name + optional key + optional value):

```tsx
import { refLabel } from "@journeyman/runs-list";

const ref = refLabel(r.inputs);
<td title={ref?.full ?? undefined}>
  <div style={{ fontWeight: 500 }}>{r.agentName}</div>
  {ref && (
    <>
      <div style={{ fontSize: 10, color: "rgb(var(--color-text-muted) / 1)", fontFamily: "ui-monospace, monospace",
                    textTransform: "uppercase", letterSpacing: ".04em", marginTop: 2 }}>
        {ref.keyLabel}
      </div>
      <div style={{ fontSize: 11, color: "rgb(var(--color-text-subtle) / 1)", fontFamily: "ui-monospace, monospace",
                    maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {ref.valueText}
      </div>
    </>
  )}
</td>
```

When `ref` is `null` (no inputs), only the agent name renders — no sub-lines, no placeholder. Column header stays **"Agent"**.

---

### Tests

**File:** `packages/runs-list/src/ref-label.test.ts`

Existing test cases are updated to assert the new `RefLabel` object shape. Key assertions:

- `refLabel(undefined)` → `null`
- `refLabel({})` → `null`
- `refLabel({ a: null })` → `null`
- `refLabel({ branch: "main" })` → `{ keyLabel: "branch", valueText: "main", full: "branch: main" }`
- `refLabel({ repo: "acme/api", branch: "main" })` → `{ keyLabel: "repo · branch", valueText: "acme/api · main", full: "repo: acme/api · branch: main" }`
- Long individual values: each clamped at 40 chars by `formatValue()` with `…`; `full` has no total-string cap
- All-null values: returns `null`

---

## Files changed

| File | Change |
|------|--------|
| `packages/runs-list/src/ref-label.ts` | New `RefLabel` type; `refLabel()` returns `RefLabel \| null` |
| `packages/runs-list/src/ref-label.test.ts` | Updated assertions for new shape |
| `packages/runs-list/src/RunsList.tsx` | Two-line Ref cell with CSS classes |
| `packages/runs-list/src/styles.css` | `.je-ref__key`, `.je-ref__val`, `.je-ref__empty` |
| `packages/runs-list/src/index.ts` | Export `RefLabel` type + `refLabel` fn |
| `packages/web/src/components/agents/AgentRunsList.tsx` | Sub-lines under agent name using imported `refLabel` |
