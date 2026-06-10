# Input Mapping: JSON Path Drilling & Attribute Merge — Design

**Date:** 2026-06-10
**Status:** Approved (design)
**Area:** flow-editor input mapping, core shape validation, orchestrator ref resolution

## Problem

In the flow editor, each step input is mapped via `WorkflowInputValue`, which is one of
`literal`, `ref`, or `template` (`packages/core/src/types/flow.types.ts`). The mention
picker (`packages/flow-editor/src/properties-panel/mention-fields.ts`) recurses into
**typed object** fields, so `step.output.issue.title` already works. But it **stops** at
two shapes:

- **Opaque JSON** (`{ type: "json"; container: "object" | "array" }`) — no declared inner
  structure, so there is nothing to enumerate or select. This is the common case for
  webhook payloads, custom-AI step outputs, and human-task payloads.
- **Typed arrays** (`{ type: "array"; items }`) — you can reference the whole array but
  cannot select an item or a field inside the items.

Two consequences:

1. **No way to reach inside opaque JSON or arrays** from the input picker.
2. Even a hand-typed deeper path is **rejected at validation** — `shapeAtPath`
   (`packages/core/src/types/shapes.ts`) returns `null` the moment it descends past a
   `json` shape ("Path not found").

Separately, users were unaware they can **combine multiple attributes** into one input
(e.g. `fullName=sam-repo/jrmen` + `ticketNumber=6` → `sam-repo/jrmen/6`). This is already
supported by the `template` kind but is not discoverable in the UI.

## Goals

- Let a user drill into an opaque `json` value or an array by typing a path after the
  reference: `.user.name`, `[0].title`, `[*].title`.
- Apply this to **both** opaque `json` shapes and typed arrays.
- Make the existing **merge** capability (text + multiple refs → `template`) discoverable
  in Value mode.
- Keep the existing `WorkflowInputValue` data model unchanged — paths live inside the
  `ref` string; merges remain `template`.
- **Apply to every step input** — built-in deterministic steps and custom-AI steps alike.
- Add an **inline help affordance** (info icon + popover) explaining path drilling and
  merging.

## Non-Goals

- **No iteration / fan-out.** `[*]` projects a field across items into a new array; it does
  **not** run the downstream step once per element.
- **No schema declaration or sample-payload inference** for opaque JSON (approaches B/C
  were considered and rejected in favor of free-form path entry).
- **No new "merge" mode** — Value mode already produces `template`.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Source of the pain | Opaque `json` object/array shapes (no child types definable) |
| Array intent | Specific item by index **and** field across all items (no looping) |
| Path-entry UX | **Pick source, then append path** — locked source chip + editable path tail |
| Scope | **json + typed arrays** |
| Merge UX | **Make Value mode obvious** — no new mode |
| Path affordance | Continuous reference: source chip + flush editable tail, no connector label |

## Applies to all step inputs

Path drilling and merge live in the **shared input editor**
(`InputValueEditor` + the mention/`mention-fields` system in
`packages/flow-editor/src/properties-panel/`), which every step input renders through —
both built-in deterministic steps and custom-AI steps. This is distinct from the
**tools picker**, which is gated behind `customStepId` (per `CLAUDE.md`). Drilling depends
only on the upstream source shapes surfaced for any step, so it is available everywhere
with **no per-step gating**. The implementation must not introduce any `customStepId` gate
on the path-tail input or the merge hints.

## Feature 1 — JSON Path Drilling

### Path grammar

A single canonical, JSONPath-flavored string stored inside the existing
`{ kind: "ref"; ref: string }`. No new data model.

| Intent | Tail typed | Stored ref | Result type |
|---|---|---|---|
| Object field | `.user.name` | `webhook.output.payload.user.name` | opaque `json` |
| List item by index | `[0].title` | `listPRs.output.pullRequests[0].title` | item field type (typed array) / `json` (opaque) |
| Field across all items | `[*].title` | `listPRs.output.pullRequests[*].title` | `array` of field type / `json` (opaque) |

Selector semantics:

- `.field` — object access.
- `[N]` — array index; **unwraps** one array level to the item shape.
- `[*]` — projection across all items; **stays** a collection and re-wraps the final field
  type as an `array`.
- Drilling **past an opaque `json` shape** is always allowed and yields opaque `json`
  (no type info exists, so it stays permissive against any target).
- Empty tail = reference the whole value (today's behavior).
- Nested wildcard (`[*].x[*].y`) is allowed but the result type degrades to opaque
  (`json`); we do not infer array-of-arrays precisely.

### Layer changes

**a) Editor UX** — `packages/flow-editor/src/properties-panel/`

- `mention-fields.ts` already tags each leaf's `type`. The mention picker continues to
  surface `json` and `array` leaves as selectable.
- `InputValueEditor.tsx`: when the selected leaf shape is `json` or `array`, render an
  editable **path-tail** input flush against the source chip so chip + tail read as one
  reference. Placeholder: `[0].field or .field…`.
- As the user types, live-validate the full ref and show the resolved leaf type, or an
  inline error. The source remains a locked chip (no typos on the step id).
- `input-value-serialize.ts` (`refSegmentsToInput`) builds the stored `ref` from
  source + tail.

**b) Validation** — `packages/core/src/types/shapes.ts`,
`packages/orchestrator/src/flow-json/validate-ref-shape.ts`

- Add a **path tokenizer** that understands `.field`, `[N]`, and `[*]`, replacing the
  naive `field.split(".")` currently used by `validate-ref-shape.ts`.
- Extend `shapeAtPath`:
  - On a `json` shape → allow any remaining segments, return the opaque `json` shape.
  - On an `array` shape with `[N]` → descend to `items` (unwrap).
  - On an `array` shape with `[*]` → enter projection mode; after consuming the remaining
    object path against `items`, re-wrap the final leaf as `{ type: "array"; items: leaf }`.
- Type compatibility (`validate-workflow`): opaque-json results stay permissive (as `json`
  is today); typed-array drill results are checked against the target input's expected
  shape.

**c) Runtime** — `packages/orchestrator/src/flow-json/resolve-inputs.ts`

- **No code change.** `sanitizeRef` only strips `[text](url)` markdown autolinks; `[0]`
  and `[*]` are not followed by `(` and survive untouched. `toEngineRef` passes the tail
  through verbatim, so `{ kind: "ref", ref: "listPRs.output.pullRequests[0].title" }`
  becomes `${listPRs.output.pullRequests[0].title}` for Conductor.
- Add tests proving brackets survive `sanitizeRef` and `toEngineRef`.
- **Verification spike (required before relying on `[*]`):** confirm the Conductor engine
  resolves both `[N]` index and `[*]` projection inside `${…}` (Jayway JSONPath — expected
  to work). If `[*]` does not project a list, ship `[N]` index now and handle `[*]`
  separately.

### Runtime conversion (end-to-end)

```
Editor stores          resolveInputs() (build)        Conductor (run time)        Step receives
{kind:ref|template}  → ${stepId.output.path…}      → follows path on instance   → plain value
```

The workflow instance resolves each `${…}` against actual upstream outputs and run
inputs/attributes; the step receives the finished value with no refs to interpret.

## Feature 2 — Attribute Merge (discoverability only)

Already supported: in Value mode, mixing literal text and multiple `@`-mentions produces
`{ kind: "template" }` via `valueSegmentsToInput()`
(`packages/flow-editor/src/properties-panel/input-value-serialize.ts:45`). At build time
`resolveInputs` rewrites each ref to `${…}` and preserves literal separators; Conductor
concatenates at run time.

Example: `branchName = @fullName/@ticketNumber` → `${…fullName}/${…ticketNumber}` →
`sam-repo/jrmen/6`.

**Change (UI only, no data/runtime change):**

- Value-mode placeholder/hint: `Type text and @mention to combine — e.g. @fullName/@ticketNumber`.
- Ensure mentions render as visible inline chips.
- One-line helper clarifying multiple mentions + text are allowed.

**Composition:** a part inside a merge may itself be a drilled ref, e.g.
`@fullName/@items[0].title/@ticketNumber`. Feature 1 and Feature 2 share the `ref` string
and the `template` mechanism, so they compose with no extra work.

## Feature 3 — Inline help (info icon)

A small info icon (`ⓘ`) on each input row (next to the mode tabs) opens a popover/tooltip
explaining how to map the input. Shown on every step input (built-in + custom).

**Popover content:**

> **Mapping this input**
> - **Value** — type a fixed value.
> - **@ Reference** — pull a value from an earlier step or the workflow input.
> - **Path** — after picking a JSON or list reference, type a path to reach inside:
>   - `.fieldName` — a field in an object
>   - `[0]` — an item by position (first item is `0`)
>   - `[*]` — that field from *every* item (produces a list)
>   - e.g. `payload.user.name`, `pullRequests[0].title`, `pullRequests[*].title`
> - **Combine** — in Value mode, mix text and multiple `@`-mentions to join values.
>   e.g. `@fullName/@ticketNumber` → `sam-repo/jrmen/6`

Implementation: a reusable help component in `packages/flow-editor/src/properties-panel/`
(themed via `@journeyman/theme`), rendered by `InputValueEditor`. Plain-language copy as
above. Also keep the path-box placeholder (`[0].field or .field…`) and the Value-mode
merge hint from Feature 2 as inline guidance.

## The complete input menu

| Intent | How | Stored as |
|---|---|---|
| Plain text | Value mode, type text | `literal` |
| A reference | `@`-pick a source | `ref` |
| Reference + path | `@`-pick, then type the path tail | `ref` (with path) |
| Merge | Value mode: text + multiple `@`-mentions (each may have a path) | `template` |

## Edge cases & errors

- Empty path tail → behaves exactly like today (whole json/array ref).
- Malformed tail (`[abc]`, unbalanced `[`) → inline error, ref not saved.
- Path tail on a scalar leaf → no path box shown (nothing to drill).
- Nested wildcard → allowed; result type degrades to opaque `json`.
- Opaque-json results permissive; typed-array results type-checked against target.
- Markdown sanitize: `[0]` / `[*]` are safe because they are not immediately followed by
  `(` (the only pattern `sanitizeRef` strips).

## Testing strategy

- **Unit — path tokenizer:** `items[0].title`, `items[*].title`, `a.b.c`, malformed inputs.
- **Unit — `shapeAtPath`:** json passthrough → `json`; array `[N]` unwrap; array `[*]`
  re-wrap; scalar rejects further path.
- **Unit — `validate-ref-shape`:** ok for json drill (leaf `json`); correct leaf for
  typed-array `[0]` and `[*]`.
- **Unit — `resolveInputs` / `toEngineRef`:** brackets preserved through `sanitizeRef`;
  ref → `${…}` with intact tail; template with multiple refs + separators.
- **Editor:** `InputValueEditor` shows the path tail only for `json` / `array` leaves;
  live validation surfaces type and errors.
- **Spike / integration:** Conductor resolves `${…[0]…}` and `${…[*]…}` against a real
  instance.

## Files touched (summary)

- `packages/core/src/types/shapes.ts` — path tokenizer + `shapeAtPath` extension.
- `packages/orchestrator/src/flow-json/validate-ref-shape.ts` — use tokenizer.
- `packages/flow-editor/src/properties-panel/InputValueEditor.tsx` — path-tail input + info-icon help, on every step input (no `customStepId` gate).
- `packages/flow-editor/src/properties-panel/` — reusable info-popover help component (themed via `@journeyman/theme`).
- `packages/flow-editor/src/properties-panel/input-value-serialize.ts` — build ref with tail; Value-mode hints.
- `packages/flow-editor/src/properties-panel/mention-fields.ts` — confirm json/array leaves remain selectable + drillable flag.
- `packages/orchestrator/src/flow-json/resolve-inputs.ts` — no logic change; add tests.

## Open risk

`[*]` wildcard resolution inside Conductor `${…}` is the only unverified behavior. Gate it
behind the verification spike; degrade to `[N]`-only if unsupported.
