# Design: Show workflow inputs in the Workflow Instances "Ref" column

**Date:** 2026-05-29
**Status:** Approved (design)
**Scope:** Front-end only — single file change in `@journeyman/runs-list`.

## Problem

In the Workflow Instances list, the leftmost **Ref** column shows a short summary
of a run's inputs (e.g. `issueRef=github:jouneyman-user/HireIQ#5`). For
webhook-triggered runs it almost always renders `–` (blank), even when the run
carries input data.

The cause is in `refLabel()` ([RunsList.tsx](../../../packages/runs-list/src/RunsList.tsx)):
it only renders inputs whose values are primitives (`string | number | boolean`)
and silently skips objects and arrays. Webhook trigger input mappings support
`json-object` and `json-array` types (see
[webhook-trigger-fire.ts](../../../packages/api-server/src/services/webhook-trigger-fire.ts)),
so any object/array-valued input disappears from the column entirely.

## Key facts established during brainstorming

- **The Ref value is not stored.** It is computed client-side by `refLabel()`
  from the run's `inputs` field.
- **`inputs` is already persisted and already returned** by the list API
  (`jm_workflow_instances.inputs` JSONB → `WorkflowInstance.inputs`). No DB
  migration, no API change, no new query is required.
- **`inputs` is a flat `Record<string, unknown>`** for every trigger source
  (webhook, manual, API, human). The *values* may be primitives, objects, or
  arrays.
- **The cell is already overflow-safe.** The `<td>` uses `maxWidth: 200`,
  `whiteSpace: nowrap`, `overflow: hidden`, `textOverflow: ellipsis`, and
  `refLabel()` clamps its visible string to 60 chars with the full text in the
  `title` (hover tooltip). No value, however large, can widen or wrap the column.

## Goal

Render *whatever inputs a run actually has* in the Ref column — including
object/array values — as a tidy `key=value` summary, without affecting table
layout.

## Approach

Modify `refLabel()` in `packages/runs-list/src/RunsList.tsx` only. Two parts:

### 1. A type-aware `formatValue(v)` helper

Turns any single value into a clean one-line string:

| Value type        | Rendering                                              | Example                       |
|-------------------|--------------------------------------------------------|-------------------------------|
| `string`          | as-is, no surrounding quotes                           | `issueRef=github:owner/repo#5`|
| `number`/`boolean`| `String(v)`                                            | `attempt=3`, `dryRun=true`    |
| `object`/`array`  | compact `JSON.stringify(v)`, wrapped in `try/catch`    | `labels=["bug","p1"]`         |
| `null`/`undefined`| skipped (caller drops these)                           | —                             |

If `JSON.stringify` ever throws (e.g. circular ref — not expected from JSONB,
but defensive), fall back to `"…"`.

### 2. Updated `refLabel()` logic

- Iterate all entries of `inputs`; skip only `null`/`undefined`.
- For each remaining entry, build `` `${key}=${formatValue(value)}` ``.
- **Per-value clamp:** truncate each individual formatted value to ~40 chars
  (with `…`) *before* joining, so one large blob cannot crowd out the other
  keys. The full, untruncated content remains available via the tooltip.
- Join pairs with `", "`.
- Keep the existing overall 60-char visible clamp; set the `title` to the full
  (per-value-untruncated) joined string for the tooltip.
- If no renderable pairs remain, return `{ text: "—" }` (unchanged).

## Out of scope / honest edges

- Runs with genuinely empty `inputs` (e.g. a webhook trigger with no
  `inputsMapping`) will still render `–`. There is no data to show; this is
  correct behavior, not a bug.
- No change to webhook event context display, workflow input *definitions*, the
  API, types, or the database.

## Testing

- Unit-test `refLabel()` / `formatValue()` (pure functions) for:
  - flat primitives (`{ issueRef: "github:..." }`) → unchanged output
  - object value (`{ payload: { id: 42 } }`) → `payload={"id":42}`
  - array value (`{ labels: ["bug","p1"] }`) → `labels=["bug","p1"]`
  - mixed primitives + objects → all keys present, none dropped
  - one oversized value → per-value clamp applied, other keys still visible
  - empty `inputs` / all-null values → `—`
  - unserializable value → graceful `…` fallback

## Files

- `packages/runs-list/src/RunsList.tsx` — modify `refLabel()`, add `formatValue()`.
- Co-located test file for the pure helpers (per existing package test convention).
