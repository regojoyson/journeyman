# Default Input Wiring UX — Design Spec

**Date:** 2026-05-01
**Branch:** feat-01

---

## Problem

In `FlowConfigPanel → DefaultsInputsSection`, users must type both the input name (e.g. `dirPath`) and the full ref path (e.g. `workflow.input.dirPath`) by hand. There is no discovery, no validation, and no guidance. The existing phase-level `ValuePicker` and `IoTab` already solve this for individual phases — this spec brings equivalent UX to the flow-level defaults panel.

---

## Solution Summary

Replace the two bare text inputs per row with:

1. **Name combobox** — a text input with a `▾` dropdown listing known input names grouped by phase category. Includes a `+ custom name…` escape hatch. A **scope toggle** above the list lets the user switch between "all catalog phases" (default) and "canvas phases only".

2. **Ref field with `{x}` picker** — same visual style as IoTab rows. Clicking `{x}` opens a stripped-down `ValuePicker` showing only the flow's run inputs (`workflow.input.*`). No node outputs — at flow-default level, a ref to a specific node output rarely makes sense as a global default.

3. **Auto-suggest** — when a name is selected from the dropdown and the ref field is currently empty, check whether a run input with that exact name exists. If so, auto-fill the ref as `workflow.input.<name>` and briefly highlight the field so the user notices.

---

## Architecture

### New hook: `usePhaseInputNames`

**File:** `packages/flow-editor/src/hooks/use-phase-input-names.ts`

```ts
export interface InputNameGroup { group: string; names: string[] }

export function usePhaseInputNames(
  catalog: Record<string, PhaseCatalogEntry>,
  scope: "catalog" | "canvas",
  canvasPhaseTypes: string[],   // phaseType strings of nodes on the canvas
): InputNameGroup[]
```

- **catalog scope**: iterate all `PhaseCatalogEntry` values, group by `entry.category`, collect unique input names from `Object.keys(entry.inputFields)`.
- **canvas scope**: filter entries to those whose `phaseType` is in `canvasPhaseTypes`, then same grouping logic.
- Returns deduplicated names per group, sorted alphabetically within each group.
- Returns a stable reference via `useMemo`.

### Updated component: `DefaultsInputsSection`

**File:** `packages/flow-editor/src/flow-config/DefaultsInputsSection.tsx`

**New props** (in addition to existing `defaults`, `onChange`, `readOnly`):

```ts
flow: FlowGraph           // to extract canvas nodes + run inputs
catalog: Record<string, PhaseCatalogEntry>  // from usePhaseCatalog in parent
```

`FlowConfigPanel` already holds `flow` and will call `usePhaseCatalog()` to supply `catalog`.

**Internal state:**
- `nameScope: "catalog" | "canvas"` — default `"catalog"`
- `dropdownOpenForKey: string | null` — which row's name dropdown is open
- `pickerOpenForKey: string | null` — which row's ValuePicker is open

**Run input extraction** (derived from `flow`):
```ts
const startNode = flow.nodes.find(n => n.type === "start");
const runInputs: { name: string }[] =
  (startNode?.config as any)?.runInputs ?? [];
const runInputNames = runInputs.map(r => r.name);
```

**ValuePicker source** (synthetic, run-inputs only):
```ts
const runInputSource: UpstreamSource = {
  kind: "run-input",
  id: "",
  label: "Run inputs",
  groups: [{
    title: "Run inputs",
    scope: "run-input",
    fields: runInputs.map(r => ({ name: r.name, scope: "run-input" as const })),
  }],
};
```

**Auto-suggest logic:**
Triggered in two cases when the ref field is currently empty:
1. User selects a name `n` from the name dropdown.
2. User types a name directly and the input fires `onBlur`.

In both cases:
```ts
if (runInputNames.includes(n)) setRef(rowKey, `workflow.input.${n}`);
```

### FlowConfigPanel changes

**File:** `packages/flow-editor/src/flow-config/FlowConfigPanel.tsx`

- Add `usePhaseCatalog()` call.
- Pass `flow={flow}` and `catalog={catalog}` to `DefaultsInputsSection`.

---

## UI Spec

### Scope toggle (above row list)

```
[ ] Canvas phases only  ℹ
```

Tooltip text: `"When checked, the name dropdown only shows inputs used by phases currently on this canvas. Uncheck to see names from all known phase types."`

### Row layout

```
[dirPath ▾]  [↳ workflow.input.dirPath  {x}]  [×]
```

- Name field: `flex: 1`. Contains `<input>` + `▾` button side by side (same container, border shared).
- Ref field: `flex: 2`. Styled with purple left border when filled (matches IoTab). Contains `↳` prefix, ref text, and `{x}` button.
- `×` remove button.

### Name dropdown

Opens below the name field on `▾` click. Grouped list:

```
Coding CLI
  dirPath ✓ (highlighted if selected)
  targetDir
  workspaceDir
Ticket
  ticketContent
─────────────────
  + custom name…
```

`+ custom name…` dismisses the dropdown and focuses the text input directly, letting the user type freely.

### ValuePicker

Reuses the existing `ValuePicker` component. Positioned as an absolutely-positioned overlay below the ref field (same pattern as IoTab). Shows only run inputs — no node output sources. Passes `onPick` only (no `onInsert`).

---

## Files Changed

| File | Change |
|---|---|
| `packages/flow-editor/src/hooks/use-phase-input-names.ts` | **New** — hook |
| `packages/flow-editor/src/flow-config/DefaultsInputsSection.tsx` | **Rewrite** — combobox + picker |
| `packages/flow-editor/src/flow-config/FlowConfigPanel.tsx` | **Modify** — add `usePhaseCatalog`, pass new props |

No changes to `ValuePicker`, `useUpstreamSources`, `@journeyman/core`, or the orchestrator.

---

## Out of Scope

- Wiring defaults to node outputs (decided: run inputs only for flow-level defaults).
- Persisting the scope toggle preference across sessions.
- Validation that the ref actually resolves at runtime.
