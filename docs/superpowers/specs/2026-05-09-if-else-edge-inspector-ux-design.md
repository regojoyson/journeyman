# If/Else Edge Inspector UX — Design

**Date:** 2026-05-09
**Status:** Draft
**Scope:** Flow editor — `EdgeInspector` and condition suggestion plumbing for `if` / `gateway-xor` outgoing edges.

## Problem

The current edge inspector for `if` / `gateway-xor` outgoing edges has three UX defects:

1. **Type field is unexplained.** A radio fieldset offers `conditional` vs `else` with no help text. Users don't know what they mean or when to use each.
2. **Custom-phase outputs are missing from the condition dropdown.** `condition-suggestions.ts` only consults the static phase registry. `custom-ai` phases ship with `outputSchema: {}` because their real schema is per-instance and fetched from the API at runtime — so they contribute zero entries to the dropdown.
3. **Dropdown options are unreadable.** Optgroup labels use the raw node id (e.g. `phase_abc123`) and options show the bare path (`phase_abc123.output.score`). The `WorkflowNode.displayName` field exists but is unused. Users can't tell which step or attribute they're picking.

## Goals

- Replace the confusing Type radio with a single, self-explanatory affordance.
- Show outputs from custom-ai phases in the condition dropdown.
- Make dropdown options readable: human-friendly group labels and field labels with type annotations.

## Non-goals

- Restructuring `condition-suggestions.ts` into a hook (deferred — this is the "surgical" approach).
- Caching custom-phase fetches across inspector opens (lazy fetch on each open is acceptable for now).
- Reworking the canvas-side rendering of conditional edges.

## Design

### 1. Type field → "Mark as fallback" checkbox

**File:** `packages/flow-editor/src/inspector/EdgeInspector.tsx`

Replace the `<fieldset>` Type radio (lines 60–80) with a single checkbox:

```
☐ Mark as fallback (else)
   Taken when no other conditional branch from this gateway matches.
```

Behavior:

- **Unchecked (default):** edge `type = "conditional"`, `ConditionBuilder` visible and enabled, branch label input enabled.
- **Checked:** edge `type = "else"`, `condition` cleared, `branchLabel` cleared, `ConditionBuilder` hidden, branch label input disabled.
- **Validation hint:** if the user toggles the checkbox on a gateway that already has another `else` edge, render an inline warning: "This gateway already has an else branch — only one is allowed at runtime." Do not block the toggle. Authoritative validation continues to live in `packages/flow-editor/src/state/validation.ts`.

The canvas-side label rendering for `type === "else"` already exists in `ConditionalEdge.tsx` and needs no change.

### 2. Dropdown readability

**File:** `packages/flow-editor/src/inspector/condition-suggestions.ts` (data) and `packages/flow-editor/src/inspector/ConditionBuilder.tsx` (rendering).

Extend `ConditionSuggestion` with two display-only fields:

```ts
export interface ConditionSuggestion {
  path: string;        // unchanged: stored varPath, e.g. "phase_abc123.output.score"
  group: string;       // unchanged: phase id (or "Workflow input"); stable group key
  groupLabel: string;  // NEW: "Analyze Repo · #abc123" or just "Analyze Repo" or "Workflow input"
  fieldLabel: string;  // NEW: "output.score (number)" — type omitted when unknown
  type?: "string" | "number" | "boolean" | "object" | "array";
}
```

`buildConditionSuggestions` computes labels:

- `groupLabel` for a phase: prefer `node.displayName`. If multiple groups in the result share the same display name, append ` · #` + last 6 chars of phase id to disambiguate. Fall back to the phase id when `displayName` is unset.
- `groupLabel` for workflow inputs: `"Workflow input"` (no suffix).
- `fieldLabel`: `output.<path>` plus ` (<type>)` when `type` is known.

`ConditionBuilder` rendering:

- `<optgroup label={groupLabel}>` instead of `label={group}`.
- `<option>{fieldLabel}</option>` instead of `<option>{s.path}</option>`.
- `value={s.path}` unchanged — this is the stored `varPath`, so existing flows continue to load and render correctly with their new labels.

### 3. Custom-phase output loading (lazy)

**File:** `packages/flow-editor/src/inspector/EdgeInspector.tsx` and `condition-suggestions.ts`.

Inspector loads custom-phase schemas on mount (and when `flow`/`edge.source` change):

1. Export `collectUpstreamPhases` from `condition-suggestions.ts` (currently file-local).
2. In `EdgeInspector`, when the source is `if` / `gateway-xor`, walk upstream phases and filter to nodes whose `phaseType === "custom-ai"` (or starts with `custom-ai:`) and whose `config.customPhaseId` is set.
3. For each such node, fetch `/api/orgs/:orgId/users/me/custom-phases/:id`, falling back to `/api/orgs/:orgId/custom-phases/:id` on 404 — mirroring the pattern in `packages/flow-editor/src/properties-panel/McpToolsTab.tsx` lines 60–67.
4. Run fetches in parallel via `Promise.all`. Maintain `loading: boolean` and `extraSchemas: Map<phaseId, OutputSchema>` in component state.
5. `buildConditionSuggestions` accepts an optional 4th argument `extraSchemas?: Map<string, OutputSchema>`. For each upstream phase: when the static schema is empty *and* `extraSchemas` has a hit, use the extra schema; otherwise use static.

Loading UX:

- While `loading`, render a disabled placeholder option at the top of the value `<select>` reading "Loading custom phase outputs…". Static suggestions remain visible — the user is not blocked.
- On error: render a disabled option "(failed to load some custom-phase outputs)" and `console.warn` the error. Errors do not block use of static suggestions.

`orgId` source: reuse the existing org-id source used by `McpToolsTab.tsx`. If no shared hook exists, drill via prop or context as that file does today.

## Data flow summary

```
EdgeInspector mounts on conditional edge
  ↓
  walk upstream phases (collectUpstreamPhases)
  ↓
  identify custom-ai phases with customPhaseId
  ↓
  Promise.all(fetches)  →  extraSchemas Map
  ↓
  buildConditionSuggestions(flow, gatewayId, catalog, extraSchemas)
  ↓
  ConditionBuilder renders optgroups by groupLabel,
  options by fieldLabel; value remains varPath
```

## Backwards compatibility

- Stored `varPath` values are unchanged. Existing flows with `{ "==": [{ "var": "phase_abc.output.score" }, 42] }` continue to round-trip. The dropdown will simply display the new labels.
- Edges currently typed `"conditional"` or `"else"` continue to load. The checkbox derives its checked state from `edge.type === "else"`.

## Testing

Manual verification (no unit tests added — the changes are render-layer + small data shape extension):

1. Open an `if` node's outgoing edge: confirm the checkbox replaces the radio, with help text visible.
2. Toggle the checkbox on: confirm condition disappears, branch label clears, edge `type` becomes `"else"`.
3. Open an edge whose upstream chain includes a `custom-ai` phase: confirm the dropdown shows that phase's outputs after the loading placeholder resolves.
4. Open an edge with two upstream phases sharing the same `displayName`: confirm both are disambiguated with ` · #<id>` suffix.
5. Load a flow saved before this change: confirm existing conditions render with their varPaths matched to the new labels and remain editable.

## Files touched

- `packages/flow-editor/src/inspector/EdgeInspector.tsx` — checkbox replacement, lazy fetch effect, loading state.
- `packages/flow-editor/src/inspector/ConditionBuilder.tsx` — render `groupLabel` / `fieldLabel`.
- `packages/flow-editor/src/inspector/condition-suggestions.ts` — extend `ConditionSuggestion` shape, compute labels, accept `extraSchemas`, export `collectUpstreamPhases`.
