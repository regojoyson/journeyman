# Unify structured-data types to `json object` / `json array`

**Date:** 2026-05-29
**Status:** Design — approved type set, pending spec review

## Problem

The codebase carries **two parallel vocabularies** for "structured data", and they
do not interoperate:

| Place | Type vocabulary | "structured" value called |
|---|---|---|
| Workflow inputs (`flow.types.ts` `WorkflowInputDef.type`) | `string \| number \| boolean \| json` | **json** |
| Trigger → input mapping (`workflow-trigger.types.ts` `TriggerInputMappingType`) | same | **json** |
| Custom-step inputs (`custom-steps.types.ts` `CustomStepInputType`) | `…, object, array, …` | **object / array** |
| Binding type system `Shape` (`shape.types.ts`) | `string/number/boolean/object/array/ref` | **object / array** (no `json`) |

Concretely: when the value picker builds the run-input source, a `json` workflow
input is **silently downgraded to `string`**
([use-upstream-sources.ts:76-79](../../../packages/flow-editor/src/properties-panel/use-upstream-sources.ts)).
A custom-step `object` input resolves to an empty-fields object shape. The binding
validator ([validate-workflow.ts:56](../../../packages/core/src/utils/validate-workflow.ts))
then compares `string` (got) vs `object` (expected) → mismatch → the option is
dimmed/unselectable in the `@`-mention picker. That is why a webhook `payload`
declared as `json` cannot be mapped into a custom-step `object` input.

The root cause is that `json` is not a real type in the `Shape` system, so it can
never match an `object` input.

## Goal

A single, consistent data-type vocabulary used in **every** type-selection UI and
every type union, such that a `json object` workflow input maps cleanly into a
`json object` custom-step input.

## Decisions

- **Standard type set (the "core 5"), everywhere:**
  `string` · `number` · `boolean` · `json object` · `json array`.
- The old `json` (workflow/trigger) and `object` / `array` (custom-step) options are
  **removed** from their unions and UIs.
- **No data migration.** This is a clean break for new workflows and custom steps,
  per product decision. Existing stored flows/steps with the old type strings are out
  of scope (they will validate as unknown/permissive; we are not migrating them).
- Custom steps **keep their functional types**: `string[]`, `workspaceDir`, `repoRef`,
  `template`. These are not part of the json/object confusion — they wire the
  workspace/repo or mark template strings. `string[]` remains a *typed* array, distinct
  from an opaque `json array`.
- **No additional types** (no `enum`, `date`, etc.) — the core 5 solve the reported
  problem; others can be added later if a real need appears.

## Design

### 1. New internal `Shape` variant

Add one variant to the `Shape` union in
[shape.types.ts](../../../packages/core/src/types/shape.types.ts):

```ts
| { type: "json"; container: "object" | "array"; description?: string }
```

- `json object` (UI) → `{ type: "json", container: "object" }`
- `json array`  (UI) → `{ type: "json", container: "array" }`

This is an *opaque* structured value: it has no declared nested fields, so the picker
treats it as a leaf (you bind the whole value, you do not drill into sub-fields).

### 2. Editor type unions and UI menus

All three type unions become the same flat set of string literals. Display labels
render `json-object` → "json object" and `json-array` → "json array".

- `WorkflowInputDef.type`
  ([flow.types.ts:62](../../../packages/core/src/types/flow.types.ts)):
  `"string" | "number" | "boolean" | "json-object" | "json-array"`.
- `TriggerInputMappingType`
  ([workflow-trigger.types.ts:3](../../../packages/core/src/types/workflow-trigger.types.ts)):
  same set.
- `CustomStepInputType`
  ([custom-steps.types.ts:7](../../../packages/core/src/types/custom-steps.types.ts)):
  replace `"object"` / `"array"` with `"json-object"` / `"json-array"`; keep
  `"string"`, `"number"`, `"boolean"`, `"string[]"`, `"workspaceDir"`, `"repoRef"`,
  `"template"`.

UI dropdowns updated to the new set:

- Workflow inputs editor
  ([InputsTab.tsx](../../../packages/flow-editor/src/inputs-tab/InputsTab.tsx)) —
  replace the single `json` option.
- Custom-step inputs editor
  ([InputFieldsEditor.tsx](../../../packages/web/src/components/custom-steps/InputFieldsEditor.tsx)) —
  `TYPES` array updated; old `object`/`array` replaced.

### 3. Shape adapters (editor type → `Shape`)

- `customStepToShape` / `inputTypeToShape`
  ([shape-adapter.ts](../../../packages/custom-steps/src/shape-adapter.ts)):
  `"json-object"` → `{type:"json", container:"object"}`,
  `"json-array"` → `{type:"json", container:"array"}`.
- Run-input source builder
  ([use-upstream-sources.ts:76-79](../../../packages/flow-editor/src/properties-panel/use-upstream-sources.ts)):
  **remove the json→string downgrade.** Map `json-object`/`json-array` to the new json
  shapes; keep `string`/`number`/`boolean` as today.
- `workflowInputShape`
  ([validate-workflow.ts:98-106](../../../packages/core/src/utils/validate-workflow.ts)):
  return the json shapes for `json-object`/`json-array` instead of `undefined`.

### 4. Compatibility rule

In `validateInputBinding`
([validate-workflow.ts:56](../../../packages/core/src/utils/validate-workflow.ts)):

- A `json object` (`{type:"json", container:"object"}`) is compatible with **any object
  input** — another `json object`, *or* a typed object (e.g. `RepoRef`). Both directions
  (json as producer or as consumer).
- A `json array` is compatible with **any array input** — another `json array` or a
  typed array.
- A `json object`/`json array` is **not** compatible with `string`/`number`/`boolean`.

This is intentionally permissive: the runtime keys/elements are the user's
responsibility, matching how `json` behaves today (the old code returned `undefined`
to skip validation). It removes false "type mismatch" blocks while still catching
scalar-vs-structured mistakes.

`shapesEqual`
([shapes.ts:92](../../../packages/core/src/types/shapes.ts)): add a `json` arm —
two json shapes are equal iff same `container`. (The permissive cross-matching lives
in `validateInputBinding`, not `shapesEqual`.)

`resolveShape` ([shapes.ts:71](../../../packages/core/src/types/shapes.ts)): json passes
through unchanged (no ref resolution needed).

`shapeTag` ([validate-workflow.ts:40](../../../packages/core/src/utils/validate-workflow.ts)):
`json` → `"json object"` / `"json array"` for the picker's type tags and mismatch
messages.

### 5. Picker traversal

- `flatten` ([mention-fields.ts:32](../../../packages/flow-editor/src/properties-panel/mention-fields.ts)):
  a `json` shape is a single leaf; its `type` label is `"json object"` / `"json array"`.
- `descend` ([shape-for-ref.ts:41](../../../packages/flow-editor/src/inspector/shape-for-ref.ts)):
  a `json` shape has no sub-fields — return it when the path ends, `undefined` if the
  ref tries to descend into it.
- `validate-ref-shape` in both
  [flow-editor](../../../packages/flow-editor/src/state/validate-ref-shape.ts) and
  [orchestrator](../../../packages/orchestrator/src/flow-json/validate-ref-shape.ts):
  handle the new `json` arm in their `Shape` switches.

### 6. Runtime coercion (API server)

The trigger/human/form coercion paths switch on the editor type, not `Shape`. Replace
the `case "json"` arm with `case "json-object"` / `case "json-array"`:

- [webhook-trigger-fire.ts:21-27](../../../packages/api-server/src/services/webhook-trigger-fire.ts) —
  `coerce()`: both arms pass the value through (object/array already parsed from JSON
  payload).
- [match-human-tasks.ts:107](../../../packages/api-server/src/services/match-human-tasks.ts) —
  pass-through.
- [form-submission.ts:38,80](../../../packages/api-server/src/services/form-submission.ts) —
  widget selection (`textarea`) and `JSON.parse` for string inputs apply to both arms.

## Blast radius (summary)

- **core**: `shape.types.ts`, `shapes.ts`, `validate-workflow.ts`, `flow.types.ts`,
  `workflow-trigger.types.ts`, `custom-steps.types.ts`.
- **flow-editor**: `use-upstream-sources.ts`, `mention-fields.ts`, `shape-for-ref.ts`,
  `state/validate-ref-shape.ts`, `inputs-tab/InputsTab.tsx`.
- **custom-steps**: `shape-adapter.ts`.
- **web**: `custom-steps/InputFieldsEditor.tsx`.
- **api-server**: `webhook-trigger-fire.ts`, `match-human-tasks.ts`, `form-submission.ts`.
- **orchestrator**: `flow-json/validate-ref-shape.ts`.

TypeScript's exhaustive `switch` checks over `Shape.type` and the editor type unions
will surface every remaining site once the unions change — use `npm run typecheck` as
the completeness check.

## Testing

- **Unit — `validateInputBinding`**: json-object ↔ json-object ✓; json-object ↔ typed
  object ✓ (both directions); json-array ↔ json-array ✓; json-array ↔ typed array ✓;
  json-object ↔ number/string ✗; json-object ↔ json-array ✗.
- **Unit — `shapesEqual` / `shapeTag`**: equality by container; tags render
  "json object" / "json array".
- **Unit — `shape-adapter`**: `json-object`/`json-array` map to the new json shapes.
- **Unit — `flatten` / `descend`**: json shapes are leaves with correct labels; no
  descent.
- **Update existing tests** that assumed `json` → `string` (e.g. shape-for-ref,
  mention-fields, use-upstream-sources fixtures).
- **Regression**: the reported scenario — webhook `payload` (`json object`) maps into a
  custom-step `json object` input without a type-mismatch warning.

## Out of scope

- Migration of existing flows/custom steps using the old `json` / `object` / `array`
  strings.
- Additional types (`enum`, `date`, file/attachment, typed arrays beyond `string[]`).
- Any change to how `string[]`, `workspaceDir`, `repoRef`, `template` behave.
