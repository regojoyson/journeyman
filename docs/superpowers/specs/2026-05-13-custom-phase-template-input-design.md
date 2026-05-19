# Custom AI Phase — Template Input Type

## Problem

Custom AI Phases declare typed input fields. Today every input must be bound
from upstream via the `ValuePicker` (`{ kind: "ref", ref }`). Workflow authors
have no way to provide a literal string — or a string that splices in upstream
values — directly inside the node config.

We want a new input type that renders as a textarea in the workflow editor and
supports `{{ref}}` placeholders resolved at run time.

## Scope

In scope:

- A new `"template"` value in `CustomPhaseInputType` (selectable in the
  phase-definition editor's input-type dropdown).
- A new `{ kind: "template"; template: string }` variant of
  `WorkflowInputValue`.
- Textarea + "Insert ref" UI on the workflow-editor side for `template`-typed
  inputs.
- Worker-side resolution of `{{ref}}` placeholders into a single string passed
  to the phase as the input's value.
- Save-time validation of every `{{ref}}` against the node's available
  upstream sources.

Out of scope:

- Filters, conditionals, defaults, or any template grammar beyond
  `{{<ref-string>}}`.
- A separate plain-`text` type (a template with no placeholders covers it).
- Compatibility migration between `string` and `template`; the break detector
  surfaces the type change like any other.

## Design

### Types (`@journeyman/core`)

**`packages/core/src/types/custom-phases.types.ts`** — extend
`CustomPhaseInputType`:

```ts
export type CustomPhaseInputType =
  | "string" | "number" | "boolean" | "string[]"
  | "object" | "array"
  | "workspaceId" | "repoRef" | "issueRef"
  | "template";
```

**`packages/core/src/types/flow.types.ts`** — extend `WorkflowInputValue`:

```ts
export type WorkflowInputValue =
  | { kind: "literal";  value: unknown }
  | { kind: "ref";      ref: string }
  | { kind: "template"; template: string };
```

A `template` field's runtime value is always `string` after interpolation.

### Phase-definition editor

**`packages/web/src/components/custom-phases/InputFieldsEditor.tsx`** — add
`"template"` to the `TYPES` array. No other changes; a `template` input is
declared with the same name / required / description controls as any other
type.

**`packages/web/src/flow-editor-integration/detectCustomPhaseBreaks.ts`** —
`typesCompatible` treats `template` as distinct from `string`. Changing an
existing field's type to or from `template` produces a `type-changed` break on
every workflow node referencing that custom phase, same as any other type
change. No silent migration.

### Workflow-editor form

**`packages/phases/src/custom/CustomAiConfigForm.tsx`** — branch on `f.type`
when rendering each declared input:

- `f.type !== "template"` → unchanged. Existing `getRef` / `setRef` helpers
  drive the "Pick value…" button + bound-pill backed by `{ kind: "ref" }`.
- `f.type === "template"` → render a multi-line `<textarea>` plus an
  "Insert ref" button. State is stored as
  `{ kind: "template"; template: <textarea-value> }`.

**"Insert ref" behavior:**

1. Track the textarea's current cursor position (`selectionStart`).
2. On click, open the existing `ValuePicker` popover (same component used by
   non-template fields).
3. On pick, splice `{{<picked-ref>}}` into the template string at the saved
   cursor position; close the popover; restore focus to the textarea with the
   cursor placed after the inserted span.

**Required-empty validation:** a template input is "empty" when
`template.trim() === ""`. Show the same red-bordered affordance used today for
empty required ref fields.

**Helpers:** add `getTemplate(name): string` / `setTemplate(name, template:
string)` siblings to the existing `getRef` / `setRef`. Keep each path readable
rather than collapsing into one polymorphic helper.

### Save-time ref validation

When the flow editor validates a node's inputs (the existing pass that flags
dangling `kind: "ref"` values), extend it: for each `kind: "template"` value,
regex-scan the template string for `{{(.+?)}}` segments and validate each
captured ref against the same `sources` array the `ValuePicker` consumes.
Unknown refs become flow-save errors of the same shape used for dangling refs.

### Worker-side resolution

The worker module that maps `WorkflowInputValue → PhaseInput` (located
alongside the existing `ref` resolver — exact path to be cited in the
implementation plan) gains a `kind: "template"` branch:

1. Scan the template string with `/\{\{(.+?)\}\}/g`.
2. For each captured ref, resolve it through the same value scope used by
   `kind: "ref"` resolution today. No new lookup path.
3. Coerce the resolved value to a string:
   - `string` → as-is
   - `number` / `boolean` → `String(v)`
   - `object` / `array` → `JSON.stringify(v)`
   - `undefined` or unresolved → empty string, plus a worker warning log
     (mirrors how a missing optional input behaves today; does not fail the
     run)
4. Replace the segment with the coerced value.
5. Emit the final `string` as the phase input.

The phase handler receives a plain `string` for the field — identical to how
it would receive a `string`-typed input. The phase does not need to know the
field was templated.

## UI sketch

```
┌─ fieldName *                                   template ──────────┐
│ ┌──────────────────────────────────────────────────────────────┐  │
│ │ Review {{node_abc.summary}} against                          │  │
│ │ {{workflow.input.repoName}} and report any drift.            │  │
│ └──────────────────────────────────────────────────────────────┘  │
│ [ {x} Insert ref ]                                                │
└──────────────────────────────────────────────────────────────────┘
```

## Edge cases

- **Empty template, optional field**: passes save-time validation; resolves to
  `""` at runtime.
- **Empty template, required field**: flow-save error (red border), same as a
  required ref left empty today.
- **`{{}}` or `{{ whitespace }}`**: save-time error ("empty placeholder").
- **Adjacent placeholders `{{a}}{{b}}`**: concatenated with no separator —
  expected behavior.
- **Escaping**: not supported. A literal `{{` cannot appear in a template. If
  this becomes a need later, introduce a `\{\{` escape; out of scope now.
- **Phase definition changes a field from `template` → `string`** (or vice
  versa): existing `detectCustomPhaseBreaks` flow handles it; the user
  re-binds.

## Test cases

- Phase-definition editor lets the author pick `"template"` from the dropdown
  and persists the field with `type: "template"`.
- Workflow editor renders a textarea (not a value picker) for a `template`
  field.
- "Insert ref" inserts `{{<ref>}}` at the cursor and preserves surrounding
  text.
- Save-time validation rejects a template referencing an unknown ref; passes
  when every ref resolves against `sources`.
- Worker resolves `{{ref}}` to the upstream value, applying the coercion table
  above; missing refs become `""` and emit a warning.
- Changing a field's type from `string` to `template` raises a
  `type-changed` break on dependent workflows.

## Files touched

- `packages/core/src/types/custom-phases.types.ts`
- `packages/core/src/types/flow.types.ts`
- `packages/web/src/components/custom-phases/InputFieldsEditor.tsx`
- `packages/web/src/flow-editor-integration/detectCustomPhaseBreaks.ts`
- `packages/phases/src/custom/CustomAiConfigForm.tsx`
- The flow-editor save-time input-validation module (path cited during plan)
- The worker module that resolves `WorkflowInputValue → PhaseInput` (path
  cited during plan)
