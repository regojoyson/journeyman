# Flow Input Validation — Design

**Date:** 2026-05-03
**Status:** Approved, awaiting implementation plan
**Author:** Brainstorming session with Samuel Rego

## Problem

Today, the flow editor only *visually highlights* compatible options in the value picker. Users can still select incompatible refs (e.g. binding `commit.repos` (expects `Repo[]`) to `create-workspace.output.workspaceDir` (a `string`)). The wiring saves successfully and the failure shows up only at runtime as a generic `InvalidInput` from the phase handler.

Three categories of issue currently fall through:

1. **Shape mismatch** — a ref is bound but the upstream output shape doesn't match the input's expected shape.
2. **Missing required input** — an input declared `required: true` has no Config value and no IO ref.
3. **Dangling ref** — a ref points to a node that was deleted, or to a path that doesn't exist on the upstream output schema.

Goal: catch all three at edit time so users see the problem before they run anything.

## Approach

**Picker level (A)**: incompatible bind options are visually disabled with an explanatory tooltip. The user can see what exists in the upstream output but cannot select it.

**Save-time (B)**: validation runs continuously over the flow, surfacing warnings via the existing `FlowSaveWarning` channel. Save still succeeds — warnings don't block the save button. This matches today's secret-warning UX and avoids frustrating mid-edit blocks.

Pre-run validation is intentionally out of scope for this work; if added later it would be the hard gate.

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  @journeyman/core                                                  │
│   shapes.ts ── shapesEqual, shapeAtPath  (already exists)          │
│   utils/validate-flow.ts ── NEW                                    │
│     • validateInputBinding(expected, actual) → BindingCheck        │
│     • validateFlowInputs(flow, catalog) → FlowSaveWarning[]        │
└────────────────────────────────────────────────────────────────────┘
                       ▲
                       │ imports
                       │
┌────────────────────────────────────────────────────────────────────┐
│  @journeyman/flow-editor                                           │
│   ShapeTree.tsx ── reuses validateInputBinding for picker disable  │
│   topbar/Topbar.tsx ── runs validateFlowInputs, surfaces warnings  │
│   ConfigTab.tsx ── per-input red border for flagged keys           │
│   canvas tile ── red dot when any of its inputs are flagged        │
└────────────────────────────────────────────────────────────────────┘
```

Validators live in `@journeyman/core` so server-side enforcement (e.g., `IFlowStore.update`) can adopt them later without an extraction. They are pure functions of `(flow, catalog)`.

The catalog is passed in as an argument because `@journeyman/core` cannot import from `@journeyman/phases` (that would create a dependency cycle — `phases` already depends on `core`). The caller constructs a `ValidationCatalog` from whatever source they have.

## Validation rules

### R1 — Shape mismatch

**Trigger**: input has a `kind: "ref"` value, the upstream shape resolves, and `shapesEqual(actual, expected)` is false.

**Warning**: `"<node>.<input>: expected <ExpectedShape>, got <ActualShape> from <ref>"`
**Code**: `"shape-mismatch"`

### R2 — Missing required input

**Trigger**: input declared `required: true` in the catalog, AND no Config typed value, AND no IO ref.

**Warning**: `"<node>: required input '<input>' has no value (type a Config value or bind from upstream)"`
**Code**: `"missing-required"`

### R3 — Dangling ref

**R3a (unknown node)**: ref like `step_xyz.output.foo` but `step_xyz` no longer exists in the flow.
**Code**: `"dangling-ref-node"`

**R3b (unknown path)**: ref like `clone.output.bogusField` — node exists, but `bogusField` is not in the declared output schema.
**Code**: `"dangling-ref-path"`

### R4 — Catalog gap

**Trigger**: an input bound by the user has no declared shape in `inputFields[key].shape`.

**Warning**: `"<node>.<input>: input has no declared shape — fix the phase catalog"`
**Code**: `"missing-input-shape"`

This catches catalog bugs loudly during development; non-blocking warning, so it doesn't block end users either.

### Escape hatches

The following do NOT trigger warnings:

- **Custom free-form paths** typed in the picker's "+ custom field" textbox. A small unobtrusive `(?)` icon in the picker hints "unknown shape" but no save warning is emitted.
- **Run inputs of type `"json"`** (start node `runInputs`). Treated as compatible with any shape — explicit user-controlled escape hatch.
- **`unknown` shape** if it ever appears in a catalog declaration — compatible with anything.

### Severity

All warnings emit at the same severity (`level: "warning"`). Save proceeds regardless. The pre-run gate (a future addition) would be the hard block.

## API surface

### New file: `packages/core/src/utils/validate-flow.ts`

```ts
import type { FlowGraph, FlowSaveWarning } from "../types/flow.types.ts";
import type { Shape } from "../types/shape.types.ts";

export interface ValidationCatalogEntry {
  inputFields?: Record<string, { shape: Shape; required?: boolean }>;
  outputSchema?: Record<string, Shape>;
}
export type ValidationCatalog = Record<string /* phaseType */, ValidationCatalogEntry>;

export type BindingCheck =
  | { ok: true }
  | { ok: false; reason: "shape-mismatch"; expected: Shape; actual: Shape }
  | { ok: false; reason: "unknown-shape" };

export function validateInputBinding(
  expected: Shape,
  actual: Shape | undefined,
): BindingCheck;

export function validateFlowInputs(
  flow: FlowGraph,
  catalog: ValidationCatalog,
): FlowSaveWarning[];
```

### `FlowSaveWarning` extension (existing type in `flow.types.ts`)

```ts
export type FlowSaveWarning = {
  level: "warning" | "error";
  message: string;
  // NEW optional fields:
  code?:
    | "shape-mismatch"
    | "missing-required"
    | "dangling-ref-node"
    | "dangling-ref-path"
    | "missing-input-shape"
    | "secret-missing"
    | string;
  nodeId?: string;
  inputKey?: string;
};
```

Existing secret-warning consumers don't read `code/nodeId/inputKey` and won't break.

### Caller wiring (UI)

**Topbar** ([Topbar.tsx](packages/flow-editor/src/topbar/Topbar.tsx))

```ts
const inputWarnings = useMemo(
  () => validateFlowInputs(flow, catalog),
  [flow, catalog],
);
// rendered alongside existing secretWarnings
```

**Picker** ([ShapeTree.tsx](packages/flow-editor/src/properties-panel/ShapeTree.tsx))

```ts
const check = expected ? validateInputBinding(expected, resolved) : undefined;
const compatible = !check || check.ok;
// render bind button: disabled={!compatible},
//   title={check?.ok === false ? formatReason(check) : "Bind"}
```

## UI integration

### Picker disable

`ShapeTree` currently sets a `compatible` boolean and applies a CSS class. After this work:

- Compute `check = validateInputBinding(expected, resolved)`.
- If `!check.ok && check.reason === "shape-mismatch"` → render bind button with `disabled`, `aria-disabled`, and `title="Type mismatch: expected <X>, got <Y>"`.
- If `check.ok || check.reason === "unknown-shape"` → enabled. Unknown gets a `(?)` hint icon.
- The "+ custom field..." input stays enabled (escape hatch).
- Add a `vp-shape-node--incompatible` CSS class for the greyed-out style.

### Topbar warnings panel

`Topbar.tsx` has an existing `SecretWarningsSection`. Add a sibling `InputWarningsSection`:

- Same visual style (yellow row, message text).
- Each row clickable → navigates the canvas to `nodeId`, opens its properties panel on the Config tab. Reuses the existing select-node handler.

### Per-node red dot

Each phase tile on the canvas gets a small red dot if any warning has `nodeId === thisNodeId`. Cosmetic; aids discoverability with many nodes.

### Per-input red border in the panel

In `ConfigTab.tsx` and the Required-Bindings section, if an input key has a warning, draw a thin red border around its row + show the warning message inline below. This is what makes a warning *actionable* — open the panel and immediately see which row to fix.

### When validation runs

- **Picker check**: per-render, comparison-only. Cheap.
- **Save-time validation**: memoized on `[flow, catalog]`. Recomputes whenever the flow changes, so the topbar count is live (not a save-button-only check).

### Save behavior

Save button still calls `onSave(flow)` unchanged. Warnings don't block. The warnings panel just stays visible.

## Edge cases

- **Run-input shapes**: `runInputs` types map to shapes — `string|number|boolean → Shape{type}`, `json → unknown` (escape hatch).
- **Control nodes** (loop/wait/subflow): no `inputFields` in the catalog → skipped. Subflow input validation is a possible follow-up.
- **Flow `defaults`**: don't supply `inputs`, no overlap with this work.
- **Catalog without an output schema**: walking a ref's path finds `unknown` → escape hatch (allow). A debug log entry can flag this so under-documented phases are visible to the dev team.
- **Existing flow JSONs** (yours + the example flows): purely additive validation, no migration. Opening them surfaces existing wiring problems immediately — that's a feature.
- **Performance**: O(N × M) per-flow traversal; for typical flows (10-30 nodes, 3-5 inputs each) <1ms. Memoized in the UI.

## Testing

Smoke checks only — no unit tests in this scope.

1. Open `examples/flows/end-to-end.flow.json` in the editor → topbar shows zero warnings.
2. Manually wire `commit.repos ← create-workspace.output.workspaceDir` (the canonical mistake) → topbar shows shape-mismatch warning; affected node tile shows red dot; panel row shows red border.

## Out of scope

- Pre-run validation (hard gate before a run starts).
- Server-side enforcement in `IFlowStore.update`.
- Subflow / control-node input validation.
- Custom validators per node type (overengineered for the current need).
- Unit tests.

## Decisions log

| § | Question | Choice |
|---|---|---|
| 1 | Where validation kicks in | Picker (A) + save-time (B) |
| 2 | Picker behavior for incompatible | Disabled + tooltip (A) |
| 3 | Strictness | Strict + escape hatch for custom/unknown (C) |
| 4 | Save-time scope | Shape mismatches + missing required + dangling refs (C) |
| 5 | Save-time surface | Warn but allow save, via existing FlowSaveWarning (B) |
| 5h | Catalog without declared shape | Emit warning to catch catalog bugs (option ii) |
| Approach | Where validators live | Approach 2 — `@journeyman/core` |
| Testing | Test scope | Smoke checks only |
