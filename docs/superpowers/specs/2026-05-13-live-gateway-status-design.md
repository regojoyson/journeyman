# Live Gateway Status & Skipped Branches — Design

**Date:** 2026-05-13
**Status:** Draft
**Extends:** [2026-05-10-skipped-node-indication-design.md](2026-05-10-skipped-node-indication-design.md)

## Problem

While a workflow instance is still running, `if` and `gateway-xor` nodes
look confusingly unfinished:

- **The gate node itself** stays `"pending"` for the entire run. Only when
  the workflow reaches a terminal state does it get a tick. But the gate
  clearly made its decision the moment one of its branches started.
- **Un-taken branches** stay `"pending"` for the entire run. The existing
  terminal-state pass in `computeNodeStatuses`
  ([packages/run-viewer/src/status/compute-node-status.ts:68-83](../../../packages/run-viewer/src/status/compute-node-status.ts))
  only paints them `"skipped"` after the instance completes.

Users watching a live run see boxes that "haven't run yet" when in fact
they never will, and a gate that hasn't ticked when it has clearly already
decided. Both should update live.

## Root cause

`if` and `gateway-xor` are SWITCH tasks in Conductor
([conductor-orchestrator.ts:176](../../../packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts:176)).
They don't run through `worker-harness` and therefore never emit
`phase.started` or `phase.completed` events
([worker-harness.ts:260-284](../../../packages/orchestrator/src/workers/worker-harness.ts:260)).
The branch decision is only *implicit* in the event stream: one of the
gate's downstream branches receives a `phase.started`.

## Goals

- Once a gate has decided (any node on one of its outgoing branches has a
  non-`pending` status), live-update:
  - The gate node → `"completed"` (tick)
  - All nodes on un-taken sibling branches → `"skipped"`
- Works mid-run; does not require the workflow to reach a terminal state.
- Re-entry safe: if a loop sends control back through the gate, the next
  `phase.started` re-paints affected nodes correctly.

## Non-goals

- No new engine events. Decision is inferred entirely client-side from the
  existing event stream.
- No edge-coloring changes (consistent with the existing skipped spec).
- No change to `gateway-and` (fork-join). Both branches are always taken
  there, so there's nothing to mark skipped.
- No server-side state. Status remains computed client-side on each load.

## Design

Add a new pass to `computeNodeStatuses` that runs **after** event replay
and **before** the existing terminal-state pass. The pass:

1. Iterates `args.workflow.nodes`, looking at nodes whose type is `"if"`
   or `"gateway-xor"`.
2. Finds the gate's outgoing edges (grouped by `branchLabel`).
3. For each branch, walks forward from the branch's entry node to the
   convergence node (exclusive), collecting reachable node ids.
4. A branch is **active** if any node in its reachable set has a status
   other than `"pending"`.
5. If exactly one (or more) branches are active, the gate is **decided**:
   - Mark the gate node `"completed"` (only if currently `"pending"`).
   - For each *inactive* branch, mark every reachable node still
     `"pending"` as `"skipped"`.

Convergence detection reuses the same algorithm already implemented in
[conductor-converter.ts:408 `findConvergence`](../../../packages/orchestrator/src/flow-json/conductor-converter.ts:408).
We lift it into a shared helper in `@journeyman/core` so both the
converter and the run-viewer use one implementation.

### Pass order in `computeNodeStatuses`

```
1. Initialize all nodes to "pending"
2. Replay events (phase.started/completed/failed/retrying, node.waiting, node.resolved)
3. NEW: Live gateway-decision pass (if / gateway-xor)
4. Existing terminal-state pass (cancelled / completed / failed instance)
5. Apply execution metadata (attempt, errorClass)
```

The new pass sits between (2) and (4) so:
- Live updates apply during normal running.
- The terminal pass still catches edge cases the live pass missed (e.g.,
  a gate whose chosen branch never produced a `phase.started` because the
  workflow failed earlier).

### Behavior table

| Instance status | Gate state | Affected node     | New status            |
| --------------- | ---------- | ----------------- | --------------------- |
| running         | undecided  | gate              | pending (unchanged)   |
| running         | undecided  | any branch node   | pending (unchanged)   |
| running         | decided    | gate              | **completed** (live)  |
| running         | decided    | un-taken branch   | **skipped** (live)    |
| running         | decided    | taken branch      | as per events         |
| completed/failed| —          | still-pending     | skipped (existing)    |
| cancelled       | —          | still-pending     | cancelled (existing)  |

## Edge cases

| Scenario                                            | Behavior                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Gate not yet decided                                | No change — gate and all branches stay `pending`.                                                     |
| Loop re-enters gate                                 | Re-painting happens on every event replay. A previously-`skipped` node will be overwritten to `running` when its `phase.started` arrives. Safe. |
| Nested gateway inside an un-taken branch            | Forward walk marks the inner gate `skipped` along with its branches. No special-casing.               |
| Nested gateway inside the **taken** branch          | Inner gate is evaluated independently by the same pass.                                               |
| `gateway-and` (parallel fork)                       | Not in scope of this pass. Both branches always run.                                                  |
| End nodes on un-taken branches                      | Marked `skipped` by the forward walk.                                                                 |
| Convergence node                                    | Not marked — reachable from the taken branch.                                                         |
| Gate with no convergence (branches end independently)| Forward walk terminates at each branch's End node. Still works.                                       |
| Workflow fails before gate decides                  | Live pass does nothing; existing terminal pass paints everything still-pending as `skipped`.          |

## Files changed

1. **`packages/core/src/graph/find-convergence.ts`** *(new)* — extract the
   existing `findConvergence` / `walkReachable` logic from
   `conductor-converter.ts`. Export a small API:
   ```ts
   export function findConvergence(branchHeads: string[], graph: WorkflowGraph): string | null;
   export function walkReachable(start: string, graph: WorkflowGraph, stopAt?: string): Set<string>;
   ```

2. **`packages/orchestrator/src/flow-json/conductor-converter.ts`** —
   replace the local `findConvergence` / `walkReachable` with imports from
   `@journeyman/core`. Pure refactor; behavior identical.

3. **`packages/run-viewer/src/status/compute-node-status.ts`** — add the
   new live-gateway pass between event replay and the terminal pass.

4. **No CSS / type changes.** Reuses the existing `"skipped"` and
   `"completed"` statuses and styles added by the prior spec.

## Verification

Manual smoke test on a running instance (not just terminal):

- Start an if/else workflow with a slow phase on the taken branch.
  - While the taken branch is still running, the gate itself shows a tick,
    and the un-taken branch's nodes (including its End) show "skipped".
- Same for `gateway-xor` with three branches: chosen branch progresses;
  the other two show "skipped" live; gate shows tick.
- Nested gateways: outer gate decides → outer un-taken branches skipped
  (including the nested inner gate inside them). Inner gate on the taken
  outer branch only decides once its own branch starts.
- Loop: workflow that loops back through a gate. After the second
  iteration, statuses re-resolve correctly (no stale "skipped").
- `gateway-and` (parallel fork) unaffected — behaves as today.
- Workflow still running, gate not yet decided → no premature marking.
