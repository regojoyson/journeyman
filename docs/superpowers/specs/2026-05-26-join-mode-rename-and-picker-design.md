# Join: Rename `errorMode` → `mode`, Rich Mode Info, and Picker Visibility

**Date:** 2026-05-26
**Status:** Approved (pending implementation plan)
**Related:** [parallel-fork-join-design](2026-05-24-parallel-fork-join-design.md), [upstream-sources-include-pause-nodes](2026-05-26-upstream-sources-include-pause-nodes-design.md)

## Problem

Three connected issues with the Join node:

1. **Picker blind spot.** `useUpstreamSources` uses dominator analysis, so nodes that sit on parallel branches of a Fork+Join never appear as sources for downstream steps. The user opens the input picker on a step after a parallel Fork and can't see the branch nodes at all (Human Task, Webhook Wait, etc.).
2. **Insufficient guidance on Join behavior.** The Join config UI shows a one-line description per mode. Users don't realize the choice changes which fields are available downstream, which branch outputs are safe to bind, or what happens on failure. They reach for the picker and are surprised.
3. **`errorMode` is a misleading name.** The field doesn't only govern failure handling — it also controls who waits for whom, who gets cancelled, and what the Join's output shape is. `mode` is the truthful, terser name.

## Goals

1. Surface every reachable upstream node in the picker (including parallel branches).
2. Surface the Join node itself as a picker source, exposing only the fields that are *unique to the Join* (winner, results-bag, winner-alias-output), shaped per mode.
3. Replace the one-line Join mode description with a small inline info block per mode explaining: how it runs, what downstream can see, when to use it.
4. Rename `errorMode` → `mode` everywhere in code, types, runtime payloads, and docs. No backwards-compat reads — the DB is being started fresh.

## Non-Goals

- No "Join rollup outputs" feature (user-defined Join `outputs[]` mapped from branches). Deferred.
- No first-wins inline warning when a downstream step binds to a non-winning branch's direct ref. Deferred.
- No auto-expansion of `results.<branchHeadId>.…` as a typed tree in the picker. Users drill in via the existing **"+ custom field…"** input. Deferred until ShapeTree can show friendly labels for dynamic keys.
- No changes to Conductor, no migrations.

---

## Piece 1 — Picker shows reachable upstream

### Today

[`useUpstreamSources`](../../../packages/flow-editor/src/properties-panel/use-upstream-sources.ts) computes dominators of `nodeId` and lists only those. Parallel-branch siblings never dominate a downstream join's successors, so the picker excludes them.

### Change

Replace the dominator computation (the dom-set fixed-point loop, ~lines 42–85) with a transitive reverse-walk:

```
upstream = []
seen = {}
stack = predecessors-of(nodeId)
while stack:
  id = pop()
  if id in seen: continue
  seen.add(id)
  upstream.push(id)
  for p in predecessors-of(id): push(p)
```

This is the same algorithm used by the pre-refactor `collectUpstreamSteps`. It includes every node reachable backward through edges, regardless of branching topology.

### Trade-off accepted

For XOR `If/Else` and `first-wins` Joins, branch-sibling outputs become reachable in the picker even though they may be undefined at runtime when the branch wasn't taken / didn't win. We accept this for now — the engine returns undefined for such refs, and a warning UI is a deferred polish.

---

## Piece 2 — Join is its own picker source

### Mapping from `mode` to source fields

For each upstream `join` node, push an additional `UpstreamSource` exposing only the unique-to-Join fields:

| `mode` | Fields exposed by the Join source |
|---|---|
| `fail-fast` (default) | **none** — no Join source pushed. All branch outputs are already directly referenceable. |
| `wait-all` | `results: object` (free-form) |
| `wait-all-strict` | `results: object` (free-form) |
| `first-wins` | `winner: string`, `output: object` (free-form, alias of winner's output), `results: object` |

`results` is exposed as a generic `{ type: "object", fields: {} }`. Users who want per-branch drill-down (`results.<branchHeadId>.status`) type the path via the picker's existing **"+ custom field…"** escape hatch. Documenting this in the mode info card (Piece 3) is enough — no new UI plumbing required.

### Helper file

New pure module: `packages/flow-editor/src/properties-panel/join-source.ts`

```ts
joinSource(node: WorkflowNode): UpstreamSource | null
```

Reads `node.config.mode`, returns the source per the table above, or `null` for `fail-fast` / non-Join nodes. Unit-tested in `join-source.test.ts` with one fixture per mode + a non-Join fixture.

### Wiring

Inside the per-node loop in `useUpstreamSources`, when the iterated upstream node has `type === "join"`, call `joinSource(node)` and push if non-null. Falls through (no Inputs/Outputs group from catalog — Join isn't a step).

---

## Piece 3 — Rich mode info card

### Today

[`JoinConfigEditor`](../../../packages/flow-editor/src/properties-panel/JoinConfigEditor.tsx) renders one short `desc` per mode under the `<select>`. There's a separate `outputShapeFor(mode)` that pretty-prints an example output JSON.

### Change

Replace `desc` with a structured `ModeInfo` object per mode, and render a small card under the `<select>` containing three sections:

```
Mode info
─────────
How it runs        | Both branches run. <mode-specific finishing/cancellation rule.>
Downstream sees    | <table or bullet list of refs and when they're defined>
When to use it     | <one sentence>
```

The `outputShapeFor` block is kept as a code-fenced example below the card (existing pattern), but the `"// no Join-level output"` comment for `fail-fast` is moved into the card.

Content for the four modes is the same as the explanations already worked through in conversation — short, concrete, includes the `first-wins` pause-only-branches restriction.

No new files; expand `JoinConfigEditor.tsx`. CSS uses existing `je-` utility classes; one new className `je-join-mode-info` for the card.

---

## Piece 4 — Rename `errorMode` → `mode`

Touched files (greppable list):

- `packages/core/src/index.ts` — re-export rename
- `packages/core/src/types/parallel.types.ts` — `JoinErrorMode` → `JoinMode`, `JoinConfig.errorMode` → `JoinConfig.mode`, doc comments
- `packages/core/src/validation/validate-fork-join-pairs.ts`
- `packages/flow-editor/src/properties-panel/JoinConfigEditor.tsx`
- `packages/flow-editor/src/canvas/nodes/JoinNode.tsx`
- `packages/orchestrator/src/flow-json/conductor-converter.ts` — including the Conductor `inputParameters.errorMode` → `inputParameters.mode`
- `packages/orchestrator/src/flow-json/conductor-types.ts`
- `packages/orchestrator/src/sync/first-wins-controller.ts` — reads `params.errorMode` → `params.mode`
- `docs/parallel-and-pauses.md`

Naming rules applied uniformly:

| Old | New |
|---|---|
| `JoinErrorMode` (type) | `JoinMode` |
| `JoinConfig.errorMode` (field) | `JoinConfig.mode` |
| `inputParameters.errorMode` (Conductor task) | `inputParameters.mode` |
| Local variables named `errorMode` | `mode` |

### No backwards-compat reads

DB is fresh. Any in-memory workflow JSON, stored workflow JSON, or live Conductor task payload uses the new field name immediately. Older specs/plans on disk keep their original wording (historical record); only live code and the live docs page (`docs/parallel-and-pauses.md`) are rewritten.

---

## File map

- **New:** `packages/flow-editor/src/properties-panel/join-source.ts` + `.test.ts`
- **Modified (Piece 1 + 2 wiring):** `packages/flow-editor/src/properties-panel/use-upstream-sources.ts`
- **Modified (Piece 3 UI):** `packages/flow-editor/src/properties-panel/JoinConfigEditor.tsx`
- **Modified (Piece 4 rename):** the 8 files listed above, plus `docs/parallel-and-pauses.md`.
- **No changes:** runtime (Conductor controller logic stays the same — only field names change), DB schema, migrations.

## Edge cases

- **Join with no `mode` configured.** Defaults to `fail-fast`. No Join source. Info card shows the `fail-fast` block.
- **Stray `errorMode` in flow JSON.** Treated as an unknown field on load — `mode` falls back to `fail-fast`. Acceptable because DB is fresh.
- **Picker invoked on a step inside a Fork branch** (not yet past the Join). Reachable walk includes the Fork node and any ancestors, but the Join and the sibling branch nodes don't appear (they aren't predecessors). Correct.
- **Cyclic graphs.** Existing `seen` set in the walk prevents infinite loops (matches the deleted `collectUpstreamSteps` behavior).

## Testing

- **Unit:** `join-source.test.ts` covers the four modes + non-Join input.
- **Unit:** new test `use-upstream-sources.test.ts` (does not currently exist) covers a Fork → A,B → Join → step graph, asserting both A and B appear, and the Join source appears with the right shape per mode.
- **Manual:** workflow with Fork+Join+downstream step in each of the four modes; confirm picker shows branches, Join source matches table; confirm rename is complete by typing `errorMode` in flow JSON and seeing it ignored.
- **Typecheck + boundaries:** `npm run check` clean after rename.

## Rollout

Single PR. No migration. No feature flag.
