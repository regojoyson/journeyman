# Parallel Fork/Join — Design

**Date:** 2026-05-24
**Status:** Draft (approved direction; ready for implementation plan)

## Problem

Workflows today run strictly sequentially. Two real user scenarios cannot be expressed:

1. **All-of parallel** — run several independent steps at once and only continue once all have finished. Example: kick off "analyze repo A" and "analyze repo B" in parallel, then summarize when both are done.
2. **Any-of (first-wins) parallel** — pause on multiple inputs at once and continue with whichever resolves first. Example: pause for a human approval *or* a Jira-status-change webhook; whichever happens first, continue.

The orchestrator (Conductor) supports FORK_JOIN natively, and the converter has a partial `emitForkJoin` implementation, but:

- No first-class Join node exists — convergence is auto-detected, making the join invisible to users.
- No error-mode configuration exists.
- No first-wins (race) semantics exist.
- Editor support is a stub canvas tile with "coming soon" gating.

## Decision

Introduce a visible, explicit **Fork / Join pair** as two new first-class node types. The Join carries the configuration, including a 4-way **error mode** that covers both "all-of" and "first-wins" scenarios.

| Concept | Node type | Role |
|---|---|---|
| Fork | `gateway-and` | Splits flow into N parallel branches |
| Join | `join` | Waits for branches and decides how/when to continue |

The Join's `errorMode` field selects behavior:

| Mode | Behavior |
|---|---|
| `fail-fast` *(default)* | First branch error → cancel siblings, fail workflow. |
| `wait-all` | Let every branch finish (success or error). Workflow fails only if *all* branches failed. |
| `wait-all-strict` | Let every branch finish. Workflow fails if *any* branch failed. |
| `first-wins` | First branch to *succeed* → cancel siblings, continue with that branch's output. Restricted to branches containing only pause nodes (see below). |

## Out of scope (deferred)

- **`first-wins` with running steps in branches.** v1 restricts first-wins branches to pause nodes only (`human-task`, `webhook-wait`, `timer`). Cancellation of in-flight worker steps (Claude calls, git operations) requires a cancellation framework that is not justified by current demand.
- **Branch retry as a join-level concept.** Each step inside a branch retries via its own `retry` config — no new branch-retry primitive.
- **Dynamic fork** (forking N branches based on a runtime array). Conductor supports `FORK_JOIN_DYNAMIC` but no user has asked for it; defer.
- **N-of-M completion** (e.g., "continue when any 3 of 5 branches succeed"). Defer.

## Node types

### `gateway-and` (Fork)

```ts
// node.type === "gateway-and"
node.config = {
  description?: string;   // free-form documentation
};
```

Graph constraints:
- Exactly 1 incoming edge.
- ≥ 2 outgoing edges.
- Each outgoing edge starts a branch that must terminate at exactly one matching `join` node.

The Fork itself carries no error / mode config — that lives on the Join.

### `join` (Join)

```ts
// node.type === "join"
node.config = {
  errorMode?: "fail-fast" | "wait-all" | "wait-all-strict" | "first-wins"; // default: "fail-fast"
  description?: string;
};
```

Graph constraints:
- ≥ 2 incoming edges, one per branch from the paired Fork.
- Exactly 1 outgoing edge.
- Exactly one matching `gateway-and` (its Fork). Cannot be shared between Forks.

## Branch topology rules (validated in core, surfaced in editor)

Encoded in a new `validateForkJoinPairs(graph)` function in `@journeyman/core`. Called from the editor on every change and from `validateForPublish`.

1. **Pair existence.** Every `gateway-and` must have exactly one matching `join`. Every `join` must have exactly one matching `gateway-and`. Pairing is determined by walking outgoing edges: every path from the Fork must reach the same Join.
2. **Closed branches.** Every branch from a `gateway-and` must reach its paired Join. No branch may reach `end` directly. (To terminate the workflow from inside a branch, use a `terminate`-style step within that branch.)
3. **No crossed pairs.** If branch X contains an inner `gateway-and`, that inner Fork must close to its inner Join before branch X reaches the outer Join.
4. **No shared steps across branches.** A non-Fork/Join node belongs to exactly one branch. If a step needs to appear in two branches, the user copies it.
5. **`first-wins` restriction.** When the Join's `errorMode === "first-wins"`, every branch from its Fork must contain only pause nodes (`human-task`, `webhook-wait`, `timer`) and no `step` nodes.

Each rule produces a precise validation error with the offending node id(s) and a one-line fix suggestion.

## Runtime semantics

### Conductor mapping

The converter rewrites the existing `emitForkJoin` to use the **explicit** pair. Drops the auto-convergence walk.

- `gateway-and` node emits a `FORK_JOIN` task with `taskReferenceName = forkNodeId` and `forkTasks = [<branch1 task sequence>, <branch2 task sequence>, …]`. Each branch sequence is built by walking outgoing edges from the Fork until the paired Join is reached.
- `join` node emits a `JOIN` task with `taskReferenceName = joinNodeId` and `joinOn = [<last task of each branch>]`. The join's `inputParameters` carry `errorMode`.

Conductor's native JOIN handles `fail-fast`, `wait-all`, and `wait-all-strict` directly via its standard JOIN failure semantics (which can be tuned through `joinOn` and the task's error propagation flags). `first-wins` is implemented as a thin orchestrator-side controller that wraps the standard JOIN:

- The JOIN is configured to complete when the first branch's last task succeeds.
- When that happens, the orchestrator iterates the other branches' currently-running tasks and posts a `CANCELLED` completion to each (single Conductor API call per task).
- Because v1 restricts first-wins branches to pause nodes, every "currently running" task is a HUMAN task — cancellation is unambiguous and side-effect-free.
- The Join's NodeExecution row records `winner = <branchHeadNodeId>` for downstream reference.

### Output reference convention

Downstream nodes (after the Join) can reference branch outputs two ways:

1. **Direct by node id** — the same convention used everywhere. `stepA.field` reads Step A's output. Works for all four error modes, with one caveat: for `first-wins`, only the winning branch's nodes will have defined outputs at runtime. Editor warns when referencing a non-winning-branch node from after a first-wins Join.
2. **Through the Join** — for cases where downstream needs to *know* which branch fired or *which branches failed*:
   - `joinNode.winner` — the branch head node id of the winning branch (first-wins only; null/missing for other modes).
   - `joinNode.output` — alias for the winning branch's last node's output (first-wins only).
   - `joinNode.results[<branchHeadNodeId>]` — `{ status: "success" | "error" | "cancelled", output: <last node's output | null>, error?: string }` (`wait-all` and `wait-all-strict` only). For `first-wins`, only the winning branch appears here.

The Join's properties panel renders the relevant output shape inline (read-only, with copy-buttons) so authors see exactly what's available.

### Error matrix

| Mode | Branch A errors | Branch B succeeds | Workflow result |
|---|---|---|---|
| `fail-fast` | A's error cancels B mid-flight | B may be partway through | Fails immediately |
| `wait-all` | A's error is captured; B runs to completion | B's output captured | Succeeds (since not all failed) |
| `wait-all-strict` | A's error is captured; B runs to completion | B's output captured | Fails (any failure → fail) |
| `first-wins` (B succeeds first) | A cancelled (paused task only) | B's output is `join.output` | Succeeds with B's output |
| `first-wins` (all branches fail) | A and B both error | n/a | Fails with aggregated error |

`first-wins` *never* lets a branch failure win — it waits for a successful branch or until all branches have failed.

## Editor & UX

### Canvas

- **Fork tile** (`gateway-and`): diamond shape, "+" icon (BPMN convention), badge showing branch count (`× 3`), accent color matches other gateways. Source handle accepts unlimited outgoing edges.
- **Join tile** (`join`): diamond shape, "⋈" icon, badge showing how many branches are still pending at runtime. Target handle accepts the N matching incoming branches.
- **Edge highlighting**: when a Fork or Join is selected, all edges from the Fork to its paired Join (across all branches) highlight. Users instantly see the scope of the pair.
- **Validation overlay**: when a pair rule is violated, the offending nodes get a red outline with a tooltip naming the rule.

### Properties panel

- **Fork**: a slim Config tab with a `description` field and a read-only branch count.
- **Join**: a Config tab with:
  - **Error mode** — dropdown of four options, each with a one-line plain-English description shown beneath.
  - **Description** — free-text.
  - **Branch summary** — read-only list: "Branch from `<head node id>` — N nodes — reaches Join via edges `<…>`."
  - **Output shape** — pretty-printed example of what downstream can reference. Updates live as the mode changes. For `first-wins`, includes a warning callout that branches must contain only pause nodes (link to docs).

### Palette

- `gateway-and` (already exists, drop `comingSoon: true`).
- `join` — new entry, same category ("Logic"), distinct icon and color.

### Run-viewer

- **Fork** node shows `running` while any branch is active.
- Each branch's nodes show their own statuses independently — one branch can be `done` while another is `running` or `waiting`.
- **Join** node shows `waiting` with tooltip "N of M branches complete" until the mode's completion condition is met.
- For `fail-fast` and `first-wins`: cancelled-branch nodes get a `cancelled` visual treatment (greyed out, distinct from `error`).
- The Join's NodeExecution stores `winner` and the per-branch summary for the Run Detail page.

## Code structure changes

### Types (`@journeyman/core`)

- `flow.types.ts` — add `"join"` to `WorkflowNodeType`. (`"gateway-and"` already present.)
- New `types/parallel.types.ts` — `JoinConfig` (errorMode + description), `JoinErrorMode` union, `JoinBranchResult` (`status`, `output`, `error`), `JoinNodeOutput` shape for the three modes that emit structured results.
- `validation/validate-fork-join-pairs.ts` — pair detection + topology rules + `first-wins` pause-only check. Returns `Array<{ nodeId, rule, message }>`.
- `index.ts` — re-export the new types and validator.

### Converter (`@journeyman/orchestrator`)

- `conductor-converter.ts`:
  - Rewrite `emitForkJoin` to use the explicit pair: walk each branch from Fork outgoing edges until the paired Join is hit; the Join is the explicit boundary, not a detected convergence.
  - Add `emitJoin` that emits the Conductor `JOIN` task with `joinOn` and `inputParameters.errorMode`.
  - Add `"join"` to the dispatch switch.
- `conductor-types.ts` — extend `JoinTask.inputParameters` to carry `errorMode` and (for `first-wins`) the list of paired branch task names so the cancellation controller knows what to kill.
- New `flow-json/first-wins-controller.ts` — orchestrator-side helper that watches a first-wins JOIN, detects the first successful branch, and posts CANCELLED completions to the remaining branches' currently-pending tasks. Wired in the worker harness or sync layer (location decided during plan-writing).

### Editor (`@journeyman/flow-editor`)

- `canvas/nodes/GatewayAndNode.tsx` — replace minimal tile with the proper diamond + badge.
- `canvas/nodes/JoinNode.tsx` — new tile.
- `canvas/node-registry.ts` — register `"join"`.
- `canvas/edge-highlighting.ts` (new) — selecting a Fork or Join highlights the pair's edges.
- `palette/built-in-categories.ts` — drop `comingSoon` on `gateway-and`; add `join` entry.
- `state/validation.ts` — call `validateForkJoinPairs` and surface errors with the same UX as other rule violations.
- `properties-panel/JoinConfigEditor.tsx` (new) — error-mode dropdown, description, branch summary, output preview.
- `properties-panel/ForkConfigEditor.tsx` (new, slim) — description + branch count.
- `properties-panel/ControlNodeConfigTab.tsx` — dispatch `gateway-and` and `join` to the new editors.
- `properties-panel/PropertiesPanel.tsx` — include `"gateway-and"` and `"join"` in the control-node branch.

### Run-viewer (`@journeyman/run-viewer`)

- Recognize `gateway-and` and `join` for status rendering.
- Render the cancelled-branch visual treatment when a NodeExecution status is `cancelled`.
- Surface the Join's `winner` and per-branch summary on the Run Detail page.

### API server

- No new endpoints required. Existing workflow CRUD + run-detail endpoints carry the new node types and config through unchanged.
- The first-wins cancellation controller is invoked from the existing orchestrator/sync surface — no new route.

## Testing strategy

(Per user direction earlier in the session: no unit-test scaffolding is mandated for the implementation plan. The acceptance criteria below are the verification target.)

## Acceptance criteria

- Authoring a `gateway-and` and a `join` in the editor produces a publishable workflow when paired correctly. Mispaired or unclosed branches surface as editor errors before publish.
- A workflow with three sequential steps in each of two branches runs them concurrently end-to-end. Both branches finish; the next node after the Join runs.
- A workflow with `errorMode: "fail-fast"` and an erroring branch terminates with the other branch cancelled and the workflow status `failed`.
- A workflow with `errorMode: "wait-all"` and one erroring branch lets the other branch complete; the workflow succeeds; `joinNode.results` carries both branch summaries.
- A workflow with `errorMode: "wait-all-strict"` and one erroring branch lets the other branch complete; the workflow fails; `joinNode.results` carries both branch summaries.
- A workflow with `errorMode: "first-wins"` and two branches (one `human-task`, one `webhook-wait` on the same issue ref): resolving the human-task first cancels the webhook-wait and the workflow continues with the human-task's output as `joinNode.output`. Resolving the webhook-wait first does the symmetric thing.
- Placing a `step` node inside a `first-wins` branch produces an editor validation error before publish.
- The run-viewer shows per-branch live status; cancelled branches are visually distinct from errored branches.
- All existing single-path workflows continue to pass typecheck and existing tests.

## Open questions (resolve during planning)

1. **First-wins controller location** — orchestrator worker harness vs api-server sync vs a dedicated background watcher. Whichever surface already observes Conductor task completions for the rest of the system.
2. **Edge type for branches** — reuse `default` edges or introduce a `parallel` edge type for visual distinction. Default to `default` unless a clear UX win surfaces during editor work.
3. **`description` field placement** — Fork-only, Join-only, or both. Defaulting to both for symmetry with other node types.
