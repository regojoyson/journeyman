# Typed Input Value Editor — Design

**Date:** 2026-06-01
**Status:** Approved (design)
**Area:** `@journeyman/flow-editor`, `@journeyman/steps`, `@journeyman/core` (validation)

## Problem

Step inputs in the flow editor can currently only be **bound to an upstream value** via the `@`
reference picker. There is no way to supply a literal value directly — even though each input
declares a type (`string`, `number`, `boolean`, `json-object`, `json-array`, `workspaceDir`).

Concretely, in `CustomAiConfigForm.tsx` each input field renders a bare `MentionInput` whose
`onChange` keeps only `soleRefOf(next) ?? ""`, so **any literal text the user types is discarded** —
only a single `@` reference can be persisted. The user wants to provide a typed literal value
appropriate to the input's type (type text for a string, give JSON for a JSON input, etc.) in
addition to the `@` reference.

The data model already supports this: `WorkflowInputValue` is a discriminated union
(`packages/core/src/types/flow.types.ts:56`):

```ts
export type WorkflowInputValue =
  | { kind: "literal"; value: unknown }
  | { kind: "ref"; ref: string }
  | { kind: "template"; template: string };
```

The API validation (`packages/api-server/src/schemas/update-flow.ts`) and runtime resolver
(`packages/orchestrator/src/flow-json/resolve-inputs.ts`) already accept all three kinds. This is
therefore primarily a **UI gap**.

## Goals

- Let users enter a literal value for a step input, with an editor chosen by the input's declared type.
- Keep the existing `@` reference binding available, switched via an explicit per-field mode toggle.
- Preserve existing string template behavior (mixed text + inline `@` refs, e.g. `PR-${ticket.id}`).
- Build the capability once as a shared component so all *typed value slots* benefit.

## Non-Goals

- No changes to path/reference-by-nature slots: `ConditionBuilder` `varPath`, `IoTab` key mapping.
- No changes to `SchemaForm` config fields (they live in `node.config` and already have
  number/checkbox/select widgets).
- No changes to the orchestrator/engine — `resolve-inputs.ts` already handles all three kinds.

## Decisions (from brainstorming)

1. **Interaction model:** explicit per-field `Value | @ Reference` mode toggle (not a single blended field).
2. **Scope:** only typed value slots that pass an `expected` shape — `CustomAiConfigForm` input
   fields and `ConfigTab` bind-only fields. Path/ref slots keep ref-only behavior.
3. **String templates preserved:** for string types, Value mode is still the blended editor
   (text + inline `@` refs → template). Non-string types get pure typed literals.
4. **Architecture:** a new shared wrapper component (Approach 1), not an overload of `MentionInput`
   and not duplicated inline per consumer.
5. **Empty-field default mode:** Reference (preserves "@ to bind" as the primary action).
6. **Persistence:** both target sites write to `node.inputs[key]` as a `WorkflowInputValue`.

## Architecture

### New component: `InputValueEditor`

Location: `packages/flow-editor/src/properties-panel/InputValueEditor.tsx`
Exported from `packages/flow-editor/src/index.ts` (so `@journeyman/steps`' `CustomAiConfigForm`
can import it, the same way it already imports `MentionInput`, `toMentionFields`, `soleRefOf`).

```ts
interface InputValueEditorProps {
  value: WorkflowInputValue | undefined;   // current binding for this field
  expected: Shape | undefined;             // drives the literal-mode widget
  fields: MentionField[];                  // upstream sources for the @ picker
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
  onChange: (next: WorkflowInputValue | undefined) => void; // undefined === cleared
}
```

The component renders a compact `Value | @ Reference` toggle and the active editor. It owns all
serialization to `WorkflowInputValue`. `MentionInput` is **not** modified — it remains a pure
`Segment[]` editor used internally for string/reference modes.

### Type → widget mapping (Value mode)

Resolved from `expected` via `shapeTag` (from `@journeyman/core`):

| Shape | Value-mode editor | Emits |
|---|---|---|
| `string` (and `workspaceDir`) | `MentionInput` (text + inline `@` refs) | pure text → `{kind:"literal", value}`; contains a ref → `{kind:"template", template}`; sole ref → `{kind:"ref"}` (normalized) |
| `number` | number `<input>` | `{kind:"literal", value: <number>}`; empty → `undefined` |
| `boolean` | true / false control (tri-state; unset = no value) | `{kind:"literal", value: <boolean>}` |
| `json` (container `object` / `array`) | `<textarea>` with live `JSON.parse` | valid → `{kind:"literal", value: <parsed>}`; invalid → inline error, **nothing committed** |
| unknown / `undefined` | `MentionInput` (string fallback) | as the string row above |

**Reference mode** (any type): single `@` bind via `MentionInput` →
`{kind:"ref", ref}` or `undefined` when cleared. Reference type-compatibility against `expected`
is already enforced by `MentionInput`'s `incompatReason`.

### Mode defaulting

Initial mode is derived from the stored value:
- `kind === "ref"` → Reference mode
- `kind === "literal" | "template"` → Value mode
- `undefined` (empty) → Reference mode (default)

The toggle is always available (unless `readOnly`).

### JSON editing detail

The JSON textarea keeps an internal raw-text buffer in component state so partially-typed,
not-yet-valid JSON is not lost on every keystroke. On a successful parse it emits
`{kind:"literal", value: <parsed>}`. On a parse error it shows an inline message and emits nothing,
leaving the last committed value in place. When the field already holds a literal object/array,
the buffer is initialized from `JSON.stringify(value, null, 2)`.

## Data Flow & Persistence

Both target sites persist to **`node.inputs[key] = WorkflowInputValue`** (uniform). No engine
changes — `resolve-inputs.ts` already resolves:
- `literal` → raw value passed through as-is (works for boolean / number / object / array)
- `ref` → rewritten to the Conductor engine ref
- `template` → dollar-interpolated string

### `CustomAiConfigForm` (`packages/steps/src/custom/CustomAiConfigForm.tsx`)

Replace each input field's bare `MentionInput` + `setRef`/`getRef` with `InputValueEditor`:
- `value={inputs[f.name]}`
- `expected={expectedShapeForType(f.type)}` (existing helper)
- `onChange={(next) => next ? setInputs({ ...inputs, [f.name]: next }) : removeInput(f.name)}`

This fixes the current behavior where typed text is discarded.

### `ConfigTab` bind-only fields (`packages/flow-editor/src/properties-panel/ConfigTab.tsx`)

In the "Required bindings" section, replace the `MentionInput` with `InputValueEditor`, writing the
value to `node.inputs` for **all** kinds (ref / literal / template).

This corrects a latent issue: today `commitSegments` routes templates for these fields into
`node.config[key]`, but bind-only input slots are resolved from `node.inputs`, so a template there
would never resolve. Routing all kinds to `node.inputs` is the correct home.

`SchemaForm` config fields and the `pickerFor` popover for config fields are unchanged.

## Validation

Extend publish-time validation so **literal** values are type-checked against the field's
`expected` shape, mirroring the reference type-compat that `MentionInput`/`validateInputBinding`
already provide for refs:
- `number` literal must be a number; `boolean` literal must be a boolean.
- `json` literal must match the declared container (`object` vs `array`).
- Required fields must have a value (already partially covered by `validate-for-publish.ts:297`
  for `workspaceDir`; generalize to all required typed inputs).
- Invalid JSON is blocked at edit time (never committed), so it cannot reach publish.

Touch points: `packages/core/src/validation/validate-for-publish.ts` and/or the shared
`validateInputBinding` in `@journeyman/core`.

## Testing

- **`InputValueEditor` unit tests:** per-type emit correctness (string/number/boolean/json),
  mode toggle behavior, JSON parse + error path, sole-ref normalization in Value mode, and
  clear → `undefined`.
- **`CustomAiConfigForm` tests:** literal round-trips to `node.inputs`; reference still works;
  typed text is no longer discarded.
- **`ConfigTab` tests:** bind-only literal/template/ref all persist to `node.inputs`; string
  templates still survive.
- **Publish-validation tests:** typed-literal mismatches (e.g. string in a number slot, array in
  an object slot, missing required) are reported.

## Files Touched (summary)

| File | Change |
|---|---|
| `packages/flow-editor/src/properties-panel/InputValueEditor.tsx` | **New** shared component |
| `packages/flow-editor/src/index.ts` | Export `InputValueEditor` |
| `packages/steps/src/custom/CustomAiConfigForm.tsx` | Use `InputValueEditor` for input fields |
| `packages/flow-editor/src/properties-panel/ConfigTab.tsx` | Use `InputValueEditor` for bind-only fields; persist all kinds to `node.inputs` |
| `packages/core/src/validation/validate-for-publish.ts` (and/or `validateInputBinding`) | Type-check literal values against `expected` |
| `packages/flow-editor/src/styles.css` | Toggle + literal-widget styling |
| Tests across the above packages | New/updated coverage |
