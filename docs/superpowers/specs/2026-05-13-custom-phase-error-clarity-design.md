# Custom AI Phase — Error Clarity & Auto-Bind

**Date:** 2026-05-13
**Status:** Design — ready for review

## Problem

Custom AI phase nodes produce confusing publish-time errors:

```
Node 'step_2kicye' input 'issueRef' has unparseable ref ''
```

Normal (built-in) phases rarely show this kind of error. Two reasons:

1. **Normal phases auto-bind their required inputs.** When you drop a built-in phase on the canvas, [`autoBindNewNode`](../../packages/flow-editor/src/canvas/Canvas.tsx) reads its declared `inputFields` from the phase catalog and wires each required input to a matching upstream output. For custom-AI phases, `phaseType === "custom-ai"` is a stub with empty `inputFields`, so nothing auto-binds. Users end up with empty `ref: ""` values that fail validation.
2. **Errors print the internal node id**, not the user-facing display name. `step_2kicye` is meaningless to the person reading the error.

## Goals

1. New custom-AI nodes get their required inputs auto-bound from upstream outputs — same UX as normal phases.
2. The remaining "empty ref" case (input added but never connected) produces a clear error: `input 'issueRef' is not connected`.
3. All publish-time validation errors lead with the node's display name, with the internal id in parentheses for log correlation.

## Non-goals

- No schema changes, no DB changes, no API changes.
- Does not replace the existing plan `docs/superpowers/plans/2026-05-13-custom-phase-upstream-refs.md` — composes on top of it.
- Does not change runtime worker behavior — pure edit-time + publish-time concern.

## Design

### Part A — Auto-bind custom-AI inputs

**File:** `packages/flow-editor/src/canvas/Canvas.tsx`

Extend `autoBindNewNode` with a third optional argument `customPhaseDefs?: Record<string, CustomAiPhase | null>`. When `newNode.phaseType === "custom-ai"`, resolve its `inputFields` via `customPhaseToShape(def).inputFields` (using `def = customPhaseDefs[newNode.config.customPhaseId]`) instead of `catalog[phaseType].inputFields`. The rest of the function — scanning upstream nodes for a single matching output and binding `${id}.output.${fieldName}` — stays identical.

The caller (the canvas drop handler) already has access to the flow graph; thread `customPhaseDefs` through using the same `useCustomPhaseDefs` hook introduced in the existing plan (Task 2).

If `def` is still loading (not yet in the map), skip auto-bind for that node. The user can re-trigger by re-dropping, or just connect manually — same as today's behavior for nodes with no obvious upstream match.

### Part B — Friendly empty-ref error

**File:** `packages/orchestrator/src/flow-json/conductor-converter.ts`

In the validation loop, before calling `parseRef`, detect empty / whitespace-only refs and emit a dedicated message:

```ts
if (val.kind === "ref" && val.ref.trim() === "") {
  throw new WorkflowValidationError(
    `${this.label(node)} input '${field}' is not connected`,
  );
}
```

This replaces the path that currently lands in `parseRef` and surfaces as `"has unparseable ref ''"`.

### Part C — Display-name-first error labels

**Files:**
- `packages/orchestrator/src/flow-json/conductor-converter.ts`
- `packages/orchestrator/src/flow-json/validate-ref-shape.ts`

Add a private helper on `ConvertCtx`:

```ts
private label(n: WorkflowNode): string {
  const name = n.displayName?.trim();
  return name ? `Node '${name}' (${n.id})` : `Node '${n.id}'`;
}
```

Replace every `` `Node '${node.id}'` `` interpolation in the validator with `this.label(node)`. For references to other nodes (`references missing node '${parsed.source}'`, `references '${parsed.source}' which does not execute…`), look up the referenced node and use `this.label(refNode)` when it exists in the flow; fall back to the raw id when it doesn't (e.g., missing-node case).

For `validate-ref-shape.ts`, errors that mention nodes by id (`Node '${parsed.source}' not found`, `Node '${parsed.source}' is not a phase`, `Custom phase definition not loaded for node '${parsed.source}'`) should use the same label helper. To avoid duplicating the function, export a free `labelNode(n: WorkflowNode | undefined, id: string): string` from `validate-ref-shape.ts` and have `ConvertCtx.label` call it.

## Files touched

1. `packages/flow-editor/src/canvas/Canvas.tsx` — extend `autoBindNewNode` signature and resolution; thread `customPhaseDefs` at the call site.
2. `packages/orchestrator/src/flow-json/conductor-converter.ts` — add `label` helper, replace id-only error strings, add empty-ref short-circuit.
3. `packages/orchestrator/src/flow-json/validate-ref-shape.ts` — export `labelNode`, use it in node-related error strings.

## Tradeoffs

- **`displayName (id)` adds visual noise** when display names are long. Accepted because keeping the id preserves log/grep workflows.
- **Auto-bind only fires on node creation.** Existing flows with empty refs still need Parts B + C for the error to make sense. That's fine — the goal isn't to retroactively wire old flows, just to stop generating new ones.
- **Auto-bind needs the custom-phase def loaded.** If the fetch hasn't landed by drop-time, the node drops with empty inputs. The user sees this immediately and connects manually; no worse than today.

## Out of scope / future work

- Surfacing "this input has no upstream candidate" as a visual hint in the editor before publish.
- Showing the friendly name in runtime logs (currently use raw task-reference ids).
