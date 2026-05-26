# Trigger Fan-In — Design

**Date:** 2026-05-26
**Status:** Draft — pending implementation plan

## Problem

A workflow can declare 1–3 triggers (`trigger-manual`, `trigger-webhook`, `trigger-human`). The original trigger design ([2026-05-25-workflow-trigger-nodes-design.md:48](2026-05-25-workflow-trigger-nodes-design.md)) states:

> "A workflow declares ≥1 trigger nodes. All triggers feed the same downstream graph."

And ([line 199](2026-05-25-workflow-trigger-nodes-design.md)):

> "Triggers may share or diverge into downstream paths — they are not required to converge on a single first node."

In practice the intended shape is:

```
trigger-manual  ──┐
trigger-webhook ──┼──► Get Ticket ──► … rest of flow
trigger-human   ──┘
```

Any one trigger firing should kick off a new workflow instance, starting at Get Ticket.

**However**, the publish validator at [packages/core/src/validation/validate-for-publish.ts:137-150](../../packages/core/src/validation/validate-for-publish.ts) enforces "max 1 incoming default edge" on every node except `join` and `end`. Drawing 2+ triggers into the same downstream step produces a publish error and forces the user to insert a Join — but Join in turn errors with "no fork upstream" ([validate-fork-join-pairs.ts](../../packages/core/src/validation/validate-fork-join-pairs.ts)) because triggers are not a Fork.

The user is stuck. The agreed-upon design cannot be expressed in the editor today.

## Goals

- Let any non-trigger node accept multiple incoming default edges **when every incoming edge originates from a trigger node**.
- Preserve the Fork/Join discipline for parallel branches (no regression).
- No data-model change, no runtime change, no UI change.

## Non-goals

- Mixed fan-in (e.g. one trigger + one regular step → same target). Users must still add a Join for non-trigger fan-in.
- Any change to Fork/Join validation.
- Any new node type (no "Merge / Any").

## Design

### Single change: relax the incoming-edge rule

In [`validate-for-publish.ts`](../../packages/core/src/validation/validate-for-publish.ts) the loop at lines 137–150 errors when a non-join, non-end, non-trigger node has more than one incoming default edge. Extend the exemption: **also skip the error when every incoming default edge's source is a trigger node**.

Pseudocode:

```ts
for (const node of flow.nodes) {
  if (node.type === "join" || node.type === "end") continue;
  if (isTriggerNode(node)) continue;
  const incoming = defaultIncomingEdgesFor(node.id);
  if (incoming.length <= 1) continue;

  // NEW: all-triggers fan-in is allowed.
  const allFromTriggers = incoming.every(e => isTriggerNode(nodeById.get(e.source)));
  if (allFromTriggers) continue;

  errors.push({ /* existing "has N incoming arrows" error */ });
}
```

That is the whole change.

### Why this is safe

- **Runtime is unchanged.** Per the existing trigger-nodes spec, each trigger fires a separate workflow instance. At runtime, the downstream step receives exactly one activation per instance, from whichever trigger fired. The orchestrator never sees two upstream activations for the same step in the same instance.
- **Fork/Join discipline is preserved.** Parallel branches from a Fork still must converge through a Join. Triggers have no inbound edges and are not Forks, so the all-from-triggers exemption doesn't interact with the fork-join validator.
- **No graph-model migration.** The graph shape and node/edge types are unchanged.
- **No backend, UI, or orchestrator change.** Only the validator loosens.

### What stays the same

- [`validate-fork-join-pairs.ts`](../../packages/core/src/validation/validate-fork-join-pairs.ts) — unchanged.
- Orchestrator step execution — unchanged.
- Flow editor canvas, properties panel, palette — unchanged.
- Trigger config and `WorkflowGraph.inputs` — unchanged.
- All other publish-validation rules (exactly one manual trigger, ≥1 end, ≥1 trigger, orphan detection, etc.) — unchanged.

### Edge cases

| Case | Behavior |
|---|---|
| 1 trigger → 1 step | Allowed (already allowed today). |
| 2–3 triggers → same step | Allowed (NEW). |
| 1 trigger + 1 regular step → same step | Still errors — user must add a Join (no regression). |
| Triggers → Join → step | Join still errors ("no fork upstream"). User is directed to wire triggers directly to the step instead. |
| Triggers + Fork output → same step | Still errors (mixed fan-in). User must add a Join after the Fork branches, then wire the Join + triggers — which still errors. Recommendation: keep parallel work after the join, separate from the trigger fan-in point. Acceptable for v1. |

### Test cases

Add cases to the publish-validation test suite:

1. Two triggers (manual + webhook) → one step → end. **Passes.**
2. Three triggers (manual + webhook + human) → one step → end. **Passes.**
3. One trigger + one regular step → one step. **Fails** with the existing "add a Join" error.
4. Trigger + Fork branch → same step. **Fails** (mixed fan-in).
5. Existing fork-join flows. **Still pass** (no regression).

## Files touched

- `packages/core/src/validation/validate-for-publish.ts` — add the all-from-triggers exemption inside the existing loop.
- `packages/core/src/validation/__tests__/validate-for-publish.test.ts` (or equivalent) — add the cases above.

## Rollout

Pure validator change, no migration. Existing draft flows that already fail this check will start passing on republish — this is the intended unlock and is safe.
