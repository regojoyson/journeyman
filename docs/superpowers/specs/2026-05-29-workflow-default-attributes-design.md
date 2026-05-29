# Workflow Default Attributes — Design

**Date:** 2026-05-29

## Problem

A workflow today has **inputs** (`WorkflowInputDef` — name + type, no value, filled at
runtime by triggers). Steps bind their fields to those inputs through the `@`-mention
picker (`workflow.input.{name}`).

There is no way to define a **design-time constant** at the workflow level — a named,
typed value set once and reused across many steps. Users want such constants, pickable
in every step's config panel exactly like inputs.

## Goal

Add **Default Attributes**: named, typed, design-time constants defined once at the
workflow level, each carrying a fixed value, selectable in any step's config via the
existing mention picker. The Inputs tab splits into two sections — "Workflow Inputs"
(runtime) and "Default Attributes" (constant value, set in place).

Attributes mirror inputs as closely as possible: same type set, same picker, same ref
mechanism, same runtime resolution path. The only structural difference is that an
attribute def carries a `value`.

## Non-Goals (YAGNI)

- Templated/computed attribute values. Attribute values are **plain literals** — no
  refs, no `${...}`, no mapping to inputs or other attributes.
- Per-step overrides of an attribute value. Attributes are shared constants; a step that
  wants a different value simply binds something else or uses a literal.
- Secret/sensitive attributes (that belongs to the secrets subsystem).

## Data Model (`@journeyman/core`)

New type in `packages/core/src/types/flow.types.ts`, parallel to `WorkflowInputDef`:

```ts
export interface WorkflowAttributeDef {
  name: string;
  type: "string" | "number" | "boolean" | "json-object" | "json-array";
  value: unknown;          // the constant, typed per `type`
  description?: string;
}
```

Stored on the graph alongside inputs:

```ts
WorkflowGraph {
  inputDefs?: WorkflowInputDef[];
  attributeDefs?: WorkflowAttributeDef[];   // ← new
}
```

Inputs carry no value; attributes do. Otherwise they are siblings.

## Picker & Ref Scope

Attributes surface in the same `@`-mention picker as inputs and upstream outputs, as
their own group labelled "Default Attributes". Ref shape mirrors inputs:

| Source | Ref |
|---|---|
| Workflow input (existing) | `workflow.input.{name}` |
| Workflow attribute (new) | `workflow.attribute.{name}` |

Changes:

- `packages/flow-editor/src/properties-panel/mention-fields.ts` — `toMentionFields()`
  gains a branch mapping `attributeDefs` → `MentionField`s with scope
  `"workflow-attribute"`, ref `workflow.attribute.{name}`, carrying the declared `type`
  so the existing type-compatibility dimming works unchanged.
- `packages/flow-editor/src/properties-panel/use-upstream-sources.ts` — include
  `graph.attributeDefs` as a source group, always available (not gated on reachability,
  since attributes are global like inputs).

A step binds exactly as today — no new binding kind:

```ts
node.inputs[field] = { kind: "ref", ref: "workflow.attribute.branchPrefix" }
```

## Editor UI — Inputs Tab Splits Into Two Sections

`packages/flow-editor/src/inputs-tab/InputsTab.tsx` (same tab) renders two stacked
sections:

- **Workflow Inputs** — the existing table, unchanged (name / type / required /
  description).
- **Default Attributes** — a new table: name / type / **value** / description, with
  Add/Remove. Reads/writes `graph.attributeDefs`.

The value cell is a typed editor that switches on `type`:

| Type | Editor |
|---|---|
| `string` | text input |
| `number` | number input |
| `boolean` | checkbox |
| `json-object` / `json-array` | JSON textarea with parse-validation |

Extract the value editor as a small `AttributeValueField` component (switch-on-type) so
`InputsTab` stays readable.

**Name validation:** non-empty and unique within attributes. Attributes live in their
own nested runtime namespace (`workflow.input.attributes.*`), so they cannot collide with
input names — no cross-namespace rule is needed.

**JSON validation:** invalid JSON in a json-object / json-array value is blocked at edit
time — a malformed attribute cannot be saved.

## Runtime Resolution (orchestrator)

The Conductor engine resolves only the **`workflow.input.*`** namespace (the object
passed as the run's start `input`). There is no native `workflow.attribute` namespace.
So attributes are seeded *into* `workflow.input` under a nested `attributes` key, and the
editor's `workflow.attribute.{name}` ref is rewritten to a `workflow.input.attributes.*`
engine ref. Bindings stay symbolic (option B); there is one runtime source of truth.

- **Run start** — `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`
  builds the start `input` from `args.inputs` (and has the full graph as
  `args.definitionSnapshot`). Add an `attributes` key to that object, built from
  `definitionSnapshot.attributeDefs` as `{ [name]: value }`. Inputs come from the
  trigger; attributes come from each def's stored `value`. This is the genuinely new
  wiring.
- **Ref rewrite** — `packages/orchestrator/src/flow-json/resolve-inputs.ts`: a
  `{ kind: "ref" }` whose ref starts with `workflow.attribute.` resolves to the Conductor
  template `${workflow.input.attributes.<name>}`. All other refs are unchanged.
- **`parseRef()`** — recognize the `workflow.attribute.` prefix (new `RefScope`) so
  validation treats attribute refs as a known scope rather than rejecting them.
- **Conductor converter** — no structural change; it emits whatever `resolveInputs`
  returns.

**Snapshot semantics:** attributes are seeded into the run from the saved graph's
`attributeDefs[].value` at run-start, so each run snapshots the attribute value at launch
time.

## Edge Cases

- **Rename / delete a bound attribute** — same behavior as inputs today (a dangling
  `workflow.attribute.x` ref). No new handling; mirror inputs.
- **Type change after binding** — the picker re-evaluates compatibility on next open,
  like inputs.

## Testing

- Core type round-trips (`WorkflowAttributeDef` serialize/deserialize on the graph).
- `toMentionFields()` emits attribute fields with correct ref and type.
- `resolve-inputs` maps a `workflow.attribute.x` ref → `${workflow.input.attributes.x}`.
- `parseRef` recognizes the `workflow.attribute.` prefix as a known scope.
- Run-start seeds `attributeDefs[].value` into `input.attributes.*`.
- End-to-end regression: define attribute → bind in a step → value reaches the step
  input, paralleling the existing input test.

## Affected Files (summary)

| Responsibility | Path |
|---|---|
| Attribute type + graph field | `packages/core/src/types/flow.types.ts` |
| Inputs tab (two sections) + value editor | `packages/flow-editor/src/inputs-tab/InputsTab.tsx` (+ new `AttributeValueField`) |
| Picker field mapping | `packages/flow-editor/src/properties-panel/mention-fields.ts` |
| Upstream sources | `packages/flow-editor/src/properties-panel/use-upstream-sources.ts` |
| Ref rewrite + parseRef scope | `packages/orchestrator/src/flow-json/resolve-inputs.ts` |
| Run-start attribute seeding | `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts` |
