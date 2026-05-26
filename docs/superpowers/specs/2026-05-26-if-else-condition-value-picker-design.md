# If-Else Gate Condition: Use Shared `{x}` Value Picker

**Date:** 2026-05-26
**Status:** Approved (pending implementation plan)

## Problem

The if-else gate's condition row uses a flat `<select>` with `<optgroup>`s for picking the left-hand side variable ([ConditionBuilder.tsx:118-130](../../../packages/flow-editor/src/inspector/ConditionBuilder.tsx)). Every other ref-picking surface in the editor — step input bindings, control-node loop/timer expressions — uses the richer `{x}` `ValuePicker` popover (tree of sources on the left, fields on the right, "+ custom field…" escape hatch). The inconsistency confuses users and the flat select can't reach upstream step *inputs* or arbitrary ref paths.

## Goal

Replace the LHS `<select>` in `ConditionBuilder` with the same `{x}` button + `ValuePicker` popover used in step inputs. Operator and RHS value controls remain unchanged.

## Non-Goals

- No changes to the operator dropdown (`==`, `!=`, `<`, `<=`, `>`, `>=`, `in`).
- No changes to the RHS value input (text / number / boolean dropdown).
- No changes to the AND / OR row connector.
- No changes to `WorkflowEdge.condition` JsonLogic shape — `{ "==": [{ "var": "stepId.output.x" }, value] }` stays identical on disk. No migration.

## Design

### Components touched

**1. `packages/flow-editor/src/inspector/ConditionBuilder.tsx`**

- `Props.suggestions: ConditionSuggestion[]` → `Props.sources: UpstreamSource[]`.
- In `RowEditor`, the LHS `<select>` is replaced with:
  - A button styled like the existing `{x} Pick value…` button in [IoTab.tsx:92-99](../../../packages/flow-editor/src/properties-panel/IoTab.tsx). When empty, the button label is `{x} pick value…`. When set, the label is the current ref (e.g. `stepId.output.score`).
  - Clicking the button toggles a `ValuePicker` popover (same wrapper element class `je-props__picker-popover` as `IoTab`).
  - `onPick(ref)` sets `row.varPath = ref` and closes the popover.
  - `onInsert` is **not** wired up — LHS is a pure ref, not a template string.
- RHS value control type detection: replace the `suggestions.find(s => s.path === varPath)` lookup with a helper `shapeForRef(ref, sources)` that walks `sources[].groups[].fields[]` (and `ShapeTree` leaves) to find the leaf `Shape`. If no match, treat as `string`.
- `rowToExpr` continues to coerce the RHS value to `number` / `boolean` / `string` based on the resolved leaf type.

**2. `packages/flow-editor/src/inspector/EdgeInspector.tsx`**

- Remove the `buildConditionSuggestions` / `condition-suggestions.ts` imports.
- Build sources via `useUpstreamSources(flow, edge.source, catalog, customStepDefs)` from [use-upstream-sources.ts](../../../packages/flow-editor/src/properties-panel/use-upstream-sources.ts). This requires:
  - `catalog: Record<string, StepCatalogEntry>` — the existing `useStepRegistry()` already supplies entries; build a plain object keyed by `stepType`.
  - `customStepDefs: Record<string, CustomAiStep | null>` — repurpose the existing custom-step fetch logic in `EdgeInspector`. Today it fetches custom steps and converts only the output schema (`customAiOutputSchemaFromJsonSchema`). Change it to store the full `CustomAiStep` keyed by `customStepId`, so `useUpstreamSources` (which already calls `customStepToShape`) gets inputs + outputs.
- Pass `sources` to `<ConditionBuilder sources={sources} … />`. Loading / error states render above the picker button as a small inline note (replacing the `__loading__` / `__error__` pseudo-entries that were injected into `suggestions`).

**3. `packages/flow-editor/src/inspector/condition-suggestions.ts`**

- Delete file (and remove from any `index.ts` exports) once `EdgeInspector` no longer imports `buildConditionSuggestions` or `customAiOutputSchemaFromJsonSchema`.
- `collectUpstreamSteps` — verify it isn't imported elsewhere; if it is, move to a small util module. (Initial grep should confirm before deletion.)

### Reachability change

`buildConditionSuggestions` walks predecessors transparently through gateway nodes. `useUpstreamSources` uses **dominators** — only steps guaranteed to have run on every path before this gate. Dominator semantics is the correct one for conditions (a non-dominating step's output may not exist at runtime), so this is an intentional improvement.

Existing condition refs that point to non-dominating steps continue to work because:
- The `WorkflowEdge.condition` data is unchanged.
- The ref still renders on the picker button (since the button just shows the stored string).
- Users can still edit via "+ custom field…".

### New capability: step inputs as condition LHS

`UpstreamSource.groups` already exposes both `Inputs` and `Outputs` groups for each upstream node. Once `ConditionBuilder` consumes `UpstreamSource[]`, condition LHS can reference `${stepId.input.x}` in addition to `${stepId.output.x}`. No extra work — falls out of the swap.

## Edge cases

- **Empty LHS** → button shows `{x} pick value…`, RHS still renders as text input (default), row is filtered out by `rowsToExpr` (already does `rows.filter(r => r.varPath)`).
- **Ref that doesn't resolve to a leaf shape** → `shapeForRef` returns `undefined`; RHS falls back to text input, RHS value stored as string.
- **Condition referencing a step removed from the graph** → button shows the stale ref text, picker still opens (user can re-pick or clear via "+ custom field…").
- **Custom-AI upstream step whose definition fails to load** → handled by the existing fetch error path; sources list omits that step, an inline error note renders above the picker button.
- **Duplicate display names across upstream steps** → `useUpstreamSources` returns `n.displayName ?? n.stepType` per source; collisions are visible in the picker but each source is uniquely keyed by node id. (Same as everywhere else `ValuePicker` is used — no special handling needed here.)

## Testing

- Unit: `shapeForRef` returns correct leaf for `workflow.input.x`, `stepId.input.x`, `stepId.output.x`, nested paths, and unknown refs.
- Unit: `RowEditor` renders the button label as the current ref; clicking opens picker; `onPick` updates `row.varPath`.
- Integration (existing edge-inspector tests, if any): existing edges with `stepId.output.x` condition refs round-trip without modification.
- Manual: open an if-else gate edge with a custom-AI step upstream; confirm both `Inputs` and `Outputs` groups appear in the picker; confirm boolean / number leaves still render the typed RHS control.

## Rollout

Single PR. No data migration. No feature flag — the swap is local to the EdgeInspector and doesn't affect runtime evaluation.
