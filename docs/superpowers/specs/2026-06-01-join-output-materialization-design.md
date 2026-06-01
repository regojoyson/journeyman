# Join Output Materialization — Design

**Date:** 2026-06-01
**Status:** Approved (design)
**Area:** `@journeyman/orchestrator` (converter, worker step, sync), `@journeyman/core` (join output schema)

## Problem

`join` nodes advertise a `JoinNodeOutput` shape to the flow editor's binding picker:

- `first-wins` → `{ winner, output, results }`
- `wait-all` / `wait-all-strict` → `{ results }`
- `fail-fast` → null (reference branch nodes directly)

This is declared in `joinNodeOutputSchema` ([packages/core/src/utils/join-node-output.ts](../../../packages/core/src/utils/join-node-output.ts)) and documented in `JoinNodeOutput` ([packages/core/src/types/parallel.types.ts:42](../../../packages/core/src/types/parallel.types.ts)). **But nothing materializes that shape at runtime.**

The converter emits a native Conductor `JOIN` system task ([conductor-converter.ts `emitJoin`](../../../packages/orchestrator/src/flow-json/conductor-converter.ts)). Conductor's JOIN output is a raw map keyed by the joined branch-terminal refs:

```
{ "<branchTerminalRef>": <branchOutput>, ... }
```

There is no `winner`/`output`/`results` key. A repo-wide search confirms `JoinNodeOutput` is only ever used as a *type* — never constructed. So a downstream ref like `${join_<id>.output.winner}` resolves to `null`.

### Observed failure

In the reported run, `step_0khy3q.inputs.payload = { kind: "ref", ref: "join_8a8gat.output.winner" }`. At runtime `payload` resolved to `null`, and the custom-ai handler threw `Missing required input: payload`, failing the workflow. Root cause: `join_8a8gat.output.winner` does not exist in the JOIN task's output.

## Goals

- Make `join_<id>.output.{winner,output,results}` resolve to real values at runtime, for all field-bearing modes (`first-wins`, `wait-all`, `wait-all-strict`).
- Keep every existing `join.output.*` binding working unchanged (no re-wiring required for correctly-bound flows).
- Make joins visible in the run-viewer (they currently produce no execution row).
- Steer authors toward the `output` field (the winning branch's data) over `winner` (a label string), since the latter is a common mis-binding.

## Non-Goals

- No change to `fail-fast` joins (they expose no fields).
- No new user-facing palette node or join config UI.
- No optimization of the worker harness's per-step workspace creation (accepted overhead; YAGNI).
- No engine/Conductor version changes.

## Decisions (from brainstorming)

1. **Scope:** all field-bearing modes (`first-wins`, `wait-all`, `wait-all-strict`); `fail-fast` unchanged.
2. **Vehicle:** a post-JOIN **worker `SIMPLE` task** (Approach 1) that runs a pure transform — not a Conductor `INLINE`/JS expression, not compile-time ref rewriting.
3. **Ref ownership:** the finalize task owns the `join_<id>` reference name so existing bindings resolve unchanged; the native JOIN is renamed to an internal ref.
4. **Editor nudge:** make `output` the first/prominent field in the join output schema so authors don't pick `winner` (a label) by mistake.

## Architecture

### A. Converter (`emitJoin` in `conductor-converter.ts`)

For `first-wins` / `wait-all` / `wait-all-strict`:

- Emit the native Conductor `JOIN` under an **internal ref** `join_<id>__join` (changed from `node.id`). Its `joinOn` and `inputParameters` (`mode`, `branchTaskRefs`, `description?`) are unchanged.
- Emit a `SIMPLE` task immediately after:
  ```
  {
    type: "SIMPLE",
    name: "join-finalize",
    taskReferenceName: node.id,            // owns join_<id> for downstream refs
    inputParameters: {
      raw: "${join_<id>__join.output}",    // the native JOIN's aggregated branch map
      mode,                                // literal
      branchTaskRefs                       // literal string[][] (each branch's node-id chain)
    }
  }
  ```
- Return `tasks: [join, finalize]`; `nextNodeId` unchanged (`successor(node.id)`). Conductor runs `finalize` right after the JOIN by array order.

For `fail-fast`: **no change.** Keep the native JOIN as `taskReferenceName: node.id`, emit no finalize task.

### B. Pure transform — `materializeJoinOutput(mode, raw, branchTaskRefs)`

New module: `packages/orchestrator/src/workers/steps/join-finalize.ts` (pure function + the handler in a sibling file, or co-located). No I/O.

Inputs:
- `mode`: `JoinMode`.
- `raw`: `Record<string, unknown>` — the native JOIN output map, keyed by branch-terminal ref.
- `branchTaskRefs`: `string[][]` — each branch's full node-id chain; `head = chain[0]`, `terminal = chain[chain.length - 1]`.

A loser cancelled by the first-wins-controller has output shaped `{ cancelled: true, cancelledBy: "first-wins-controller", joinTaskRef: ... }`. Treat any branch whose `raw[terminal]` has `cancelled === true` as cancelled.

Output by mode:

- **first-wins** → `{ winner, output, results }`:
  - `winner` = `head` of the **first** branch (in `branchTaskRefs` order) whose `raw[terminal]` is **not** cancelled.
  - `output` = `raw[terminal]` of that winning branch.
  - `results` = `{ [winnerHead]: { status: "success", output } }` (winning entry only).
  - Fallback (no non-cancelled branch found): `winner` = `branchTaskRefs[0][0]`, `output` = `raw[firstTerminal] ?? null`, `results` = `{ [winner]: { status: "success", output } }`.

- **wait-all / wait-all-strict** → `{ results }` keyed by branch **head** id:
  - For each branch: `results[head] = { status: "success", output: raw[terminal] ?? null }`.
  - No `winner` / `output`.

- **fail-fast** → not reached (no finalize task emitted).

Shapes match `joinNodeOutputSchema`: `winner` is a string; `output` and `results` are objects.

### C. Worker handler & registration

- New `JoinFinalizeStepHandler` — `packages/orchestrator/src/workers/steps/join-finalize-step-handler.ts`.
  - `stepType = "join-finalize"`.
  - `run(input, ctx)` reads `input.mode`, `input.raw`, `input.branchTaskRefs`, calls `materializeJoinOutput`, returns `{ kind: "success", output }`. On malformed input (missing `branchTaskRefs`), returns `{ kind: "failure", failure: { errorClass: "InvalidInput", message, retryable: false } }`.
- Registered in `cli-worker.ts`: `registry.register(new JoinFinalizeStepHandler())`. The harness polls `registry.list().map(h => h.stepType)`, so this auto-adds `join-finalize` to the polled set — no separate poll-list edit.
- The step declares no provider slots, so secret resolution yields 0 slots. It goes through the standard harness (an unused workspace is created and cleaned up — accepted overhead, consistent with other lightweight steps like `send-message`).

### D. Editor nudge — `output` first

In `joinNodeOutputSchema` ([join-node-output.ts](../../../packages/core/src/utils/join-node-output.ts)), for `first-wins` return the object with `output` **before** `winner`/`results`, and add `description` text to each shape:

```ts
return {
  output:  { type: "object", fields: {}, description: "The winning branch's result — use this for downstream data." },
  winner:  { type: "string", description: "Name of the branch that won (a label, not data)." },
  results: { type: "object", fields: {}, description: "All branch results (winning entry only)." },
};
```

The mention picker flattens output-schema fields in key order, so `output` is listed first. `winner` (a string) bound into a json-object input is already dimmed/flagged by the existing ref-shape validator (`validateInputBinding`), reinforcing the nudge. No picker-component change required.

## Compatibility

- **first-wins-controller** ([packages/orchestrator/src/sync/first-wins-controller.ts](../../../packages/orchestrator/src/sync/first-wins-controller.ts)): locates joins by `taskType === "JOIN"` and reads `branchTaskRefs` from `workflowTask.inputParameters`. Both still hold after the JOIN ref rename (the `branchTaskRefs` chains are branch node ids, not the join's own ref). No code change; covered by a regression test.
- **Existing bindings** `join_<id>.output.{winner,output,results}` keep resolving — the finalize task owns `join_<id>`.
- **Run-viewer:** the join now has a worker execution row with recorded output, so it becomes visible (previously absent).

## User-Experience Impact

- **Joins work:** `join.output.*` bindings return real values instead of `null`; workflows that depended on them stop failing.
- **Joins are visible** in the run-viewer (new execution row + recorded output).
- **One author action for the reported flow:** rebind `payload` from `join.output.winner` (a label string) to `join.output.output` (the winning data). The shape validator now flags the string→json-object mismatch, guiding this.
- **Slight per-join latency:** one extra lightweight worker task per field-bearing join, plus one extra step row in the timeline.
- **Unchanged:** join node UI/config; `fail-fast` behavior.

## Testing

- **Pure-function unit tests** (`join-finalize.test.ts`):
  - first-wins: winner = first non-cancelled branch; cancelled-loser excluded; ordering respected; all-cancelled fallback; multi-node chain (head ≠ terminal) uses head for `winner` and terminal for `output`.
  - wait-all / wait-all-strict: `results` keyed by head; `output` of each = terminal output.
- **Converter tests** (`conductor-converter.*.test.ts`):
  - first-wins / wait-all emit `join_<id>__join` (JOIN) + `join-finalize` task with `taskReferenceName === node.id` and correct `inputParameters` (`raw` ref, `mode`, `branchTaskRefs`).
  - fail-fast: unchanged (JOIN keeps `node.id`, no finalize task).
- **first-wins-controller test:** still finds the renamed JOIN (`taskType === "JOIN"`) and cancels losers.
- **Schema test** (`join-node-output`): first-wins returns `output` first; field set unchanged.

## Files Touched (summary)

| File | Change |
|---|---|
| `packages/orchestrator/src/flow-json/conductor-converter.ts` | `emitJoin`: rename JOIN to `join_<id>__join` + emit `join-finalize` SIMPLE task for field-bearing modes |
| `packages/orchestrator/src/workers/steps/join-finalize.ts` | **New** pure `materializeJoinOutput` |
| `packages/orchestrator/src/workers/steps/join-finalize-step-handler.ts` | **New** `JoinFinalizeStepHandler` |
| `packages/orchestrator/src/cli-worker.ts` | Register the new handler |
| `packages/orchestrator/src/index.ts` | Export the handler (matches existing handler exports) |
| `packages/core/src/utils/join-node-output.ts` | first-wins: `output` first + field descriptions |
| Tests across the above | New/updated coverage |
