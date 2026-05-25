# Implicit Parallel Fork — Design

**Date:** 2026-05-25
**Status:** Draft
**Related:** [parallel-fork-join-design](2026-05-24-parallel-fork-join-design.md), [validate-fork-join-pairs](../../../packages/core/src/validation/validate-fork-join-pairs.ts)

## Goal

Allow any step node with 2+ outgoing `default` edges to act as a parallel fork, so users can wire a step directly to multiple downstream steps without dropping an explicit Fork (`gateway-and`) node. The explicit Fork node remains supported for users who want a visual marker for parallelism.

## Motivation

Today, every parallel fan-out requires an explicit Fork node between the upstream step and the parallel branches. For simple two- or three-way fan-outs this is ceremony — n8n / Make / Zapier all infer parallelism from the topology. The explicit Fork is genuinely useful for visually heavy parallel sections (5+ branches, deeply nested) but feels like boilerplate for the common case.

## Semantic Rule

A node is treated as a **parallel fork point** when it has ≥2 outgoing edges of type `default`.

- `default` edges → counted as parallel branches.
- `conditional` / `else` edges → ignored (belong to If/XOR semantics).
- `error` edges → ignored (belong to error-handler semantics).

This means a step with 1 default out + 1 error out is *not* an implicit fork — it's a single-success-path step with an error handler. Only when two or more *normal* edges leave the same node does it fork.

The existing `gateway-and` node is unchanged: it remains a node type whose outgoing edges are `default` edges, so it naturally fits the new rule.

## Validation Changes

File: [packages/core/src/validation/validate-fork-join-pairs.ts](../../../packages/core/src/validation/validate-fork-join-pairs.ts)

Generalize the existing walker. Currently it iterates only `gateway-and` nodes (line 33). Change it to iterate any node whose outgoing-default-edge count is ≥2.

All existing rules apply unchanged in behavior; only the rule code names need updating to reflect that the source of the branches is no longer always a Fork node:

| Old code | New code |
|---|---|
| `fork-needs-join` | `branch-needs-join` |
| `join-needs-fork` | `join-needs-branch-source` |
| `branch-escapes-to-end` | (unchanged) |
| `branches-converge-on-different-joins` | (unchanged) |
| `join-incoming-mismatch` | (unchanged) |
| `first-wins-non-pause-branch` | (unchanged) |
| `shared-step-across-branches` | (unchanged) |

The old `fork-*` codes remain emitted as aliases for one release so existing UI warning rendering keeps working.

The `ForkJoinPairError.nodeId` for `branch-needs-join` is the multi-out node (the implicit or explicit fork point).

## Orchestrator Changes

File: [packages/orchestrator/src/flow-json/find-fork-join-pairs.ts](../../../packages/orchestrator/src/flow-json/find-fork-join-pairs.ts)

Same generalization as validation: change the loop on line 33 to iterate every node with `defaultOutCount >= 2` instead of only `gateway-and`. The result shape (`ForkJoinPair { forkId, joinId, branches }`) is unchanged — `forkId` now refers to whatever node fans out (regular step or explicit Fork).

Worker spawn/join logic is unchanged. The Fork node was only ever a marker; the parallel execution mechanism reads from edges. Generalizing pair detection covers the full runtime change.

## UI / Editor Changes

File: [packages/flow-editor/src/...](../../../packages/flow-editor/src/)

1. **Drop the "Fork needed" error path.** Once validation accepts multi-out steps, the error stops being produced — no separate UI change needed.
2. **Branch indicator on multi-out steps.** Render a small branch glyph (e.g. `⫶` or fork-arrow icon) in the corner of any node with 2+ default outgoing edges. Same surface used by the status dot — purely visual signal that "this step fans out." Renders for explicit Fork nodes too (already obvious from the node type, but harmless to render twice).

The Fork palette item stays in place, unchanged in behavior.

## Edge Cases

- **Step with 1 default + 1 error out.** Not a fork (error edges don't count). Existing single-path semantics.
- **Step with 1 default + 1 conditional out.** Not valid today (conditional edges only originate from If/XOR), and not made valid by this change.
- **Multiple implicit forks in a row.** Already covered by `shared-step-across-branches` — nested forks must be properly nested with their own Joins; topology rules apply identically.
- **Implicit fork with no Join.** Same as today: `branch-needs-join` fires; user must add a Join.
- **Loop-back edge from inside a branch.** Already handled by the walker's `visited` set (line 49–52 in find-fork-join-pairs.ts).

## Out of Scope

- Removing the explicit Fork node.
- Implicit XOR (multiple outgoing edges meaning "pick one").
- Fire-and-forget parallel branches (parallel branches that terminate at End instead of converging on a Join).
- Per-edge type selection (e.g. mixing "parallel" and "alternative" semantics on edges from the same node).

## Migration

None. Existing flows with explicit Fork nodes keep working. Existing flows that *failed* validation because they tried to fan out without a Fork will start passing — this is the intended unlock and is safe.

## Verification

- Unit tests on `validateForkJoinPairs` and `findForkJoinPairs` for: multi-out regular step → join, multi-out step with mixed default+error edges, nested implicit forks, first-wins with implicit fork.
- Editor: drop two edges from a regular step into separate downstream steps, then into a Join. No validation error. Worker run completes with correct branch ordering.
- Backwards: an existing flow with an explicit Fork+Join still validates and runs.
