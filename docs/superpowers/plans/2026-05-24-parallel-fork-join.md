# Parallel Fork/Join — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two new node types — `gateway-and` (Fork) and `join` (Join) — as an explicit pair, with the Join carrying a 4-mode `errorMode` (`fail-fast`, `wait-all`, `wait-all-strict`, `first-wins`). `first-wins` is restricted to pause-only branches in v1.

**Architecture:** Fork emits Conductor's native `FORK_JOIN`; Join emits Conductor's native `JOIN` (no longer auto-synthesized). The converter switches from auto-convergence detection to explicit pair walking. A small orchestrator-side controller handles `first-wins` cancellation of paused sibling branches. New core validation function enforces pair topology rules and surfaces them in the editor.

**Tech Stack:** TypeScript, npm workspaces, Conductor (FORK_JOIN/JOIN tasks), React (editor + run-viewer), Fastify (api-server).

**Constraints from the user:**
- No new unit tests added in this plan.
- No commit steps.
- A single `npm run check` at the end (typecheck + import boundaries).

**Spec:** [docs/superpowers/specs/2026-05-24-parallel-fork-join-design.md](../specs/2026-05-24-parallel-fork-join-design.md)

---

## File Structure Overview

### New files
- `packages/core/src/types/parallel.types.ts` — `JoinErrorMode`, `JoinConfig`, `ForkConfig`, `JoinBranchResult`, `JoinNodeOutput`.
- `packages/core/src/validation/validate-fork-join-pairs.ts` — pure validator returning structured errors.
- `packages/orchestrator/src/flow-json/find-fork-join-pairs.ts` — pure helper detecting Fork↔Join pairings from a `WorkflowGraph`.
- `packages/orchestrator/src/sync/first-wins-controller.ts` — observes first-wins JOINs, cancels paused sibling branches on first success.
- `packages/flow-editor/src/canvas/nodes/JoinNode.tsx` — Join canvas tile.
- `packages/flow-editor/src/canvas/edge-highlighting.ts` — selects Fork or Join → highlights its pair's edges.
- `packages/flow-editor/src/properties-panel/ForkConfigEditor.tsx` — minimal config editor.
- `packages/flow-editor/src/properties-panel/JoinConfigEditor.tsx` — error-mode dropdown + summary + output preview.

### Modified files
- `packages/core/src/types/flow.types.ts` — add `"join"` to `WorkflowNodeType`.
- `packages/core/src/index.ts` — export new types + validator.
- `packages/core/src/validation/validate-for-publish.ts` — call the new validator and merge its errors into the publish result.
- `packages/orchestrator/src/flow-json/conductor-converter.ts` — rewrite `emitForkJoin` to use explicit pair; add `emitJoin`; register `"join"` in dispatch.
- `packages/orchestrator/src/flow-json/conductor-types.ts` — extend `JoinTask.inputParameters` with `errorMode` and `branchTaskRefs`.
- `packages/orchestrator/src/index.ts` — export the pair finder + controller.
- `packages/api-server/src/composition.ts` — wire the first-wins controller.
- `packages/api-server/src/services/engine-reconciler.ts` — on each reconcile pass, give the first-wins controller a chance to detect winners and cancel siblings.
- `packages/flow-editor/src/canvas/nodes/GatewayAndNode.tsx` — replace minimal tile with a proper diamond + branch-count badge.
- `packages/flow-editor/src/canvas/node-registry.ts` — register `"join"`.
- `packages/flow-editor/src/canvas/Canvas.tsx` — invoke edge-highlighting on selection change.
- `packages/flow-editor/src/state/validation.ts` — call `validateForkJoinPairs` and surface errors.
- `packages/flow-editor/src/palette/built-in-categories.ts` — drop `comingSoon` on `gateway-and`; add `join`.
- `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx` — dispatch `gateway-and` and `join` to the new editors.
- `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx` — include `gateway-and` and `join` in the control-node branch.
- `packages/run-viewer/src/*` — recognize the new node types for live status + render `cancelled` visual.

---

## Task 1: Add `"join"` to `WorkflowNodeType`

**Files:**
- Modify: `packages/core/src/types/flow.types.ts`

- [ ] **Step 1: Extend the union**

Edit `packages/core/src/types/flow.types.ts`. In `WorkflowNodeType`, add `"join"` immediately after `"gateway-and"`:

```ts
export type WorkflowNodeType =
  | "start"
  | "end"
  | "step"
  | "human-task"
  | "webhook-wait"
  | "gateway-xor"
  | "gateway-and"
  | "join"
  | "loop"
  | "subflow"
  | "if"
  | "timer"
  | "retry-block"
  | "try-catch";
```

---

## Task 2: New `parallel.types.ts`

**Files:**
- Create: `packages/core/src/types/parallel.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the types module**

Create `packages/core/src/types/parallel.types.ts`:

```ts
export type JoinErrorMode =
  | "fail-fast"
  | "wait-all"
  | "wait-all-strict"
  | "first-wins";

export interface ForkConfig {
  description?: string;
}

export interface JoinConfig {
  /** How the join waits for branches and propagates failure. Default: "fail-fast". */
  errorMode?: JoinErrorMode;
  description?: string;
}

export interface JoinBranchResult {
  status: "success" | "error" | "cancelled";
  /** Output of the branch's last node, or null on error/cancellation. */
  output: Record<string, unknown> | null;
  error?: string;
}

/**
 * Shape exposed at runtime as the Join node's output. Which fields are
 * populated depends on the Join's `errorMode`:
 *   - `fail-fast`: no fields (the workflow either continues with no join
 *     payload or has failed).
 *   - `wait-all` / `wait-all-strict`: `results` keyed by each branch's head
 *     node id.
 *   - `first-wins`: `winner` is the branch head node id and `output` is the
 *     winning branch's last node's output. `results` is present and contains
 *     only the winning branch's entry.
 */
export interface JoinNodeOutput {
  winner?: string;
  output?: Record<string, unknown>;
  results?: Record<string, JoinBranchResult>;
}
```

- [ ] **Step 2: Re-export from `packages/core/src/index.ts`**

Add near the other type re-exports:

```ts
export type {
  JoinErrorMode,
  ForkConfig,
  JoinConfig,
  JoinBranchResult,
  JoinNodeOutput,
} from "./types/parallel.types.ts";
```

---

## Task 3: Pair detection helper

**Files:**
- Create: `packages/orchestrator/src/flow-json/find-fork-join-pairs.ts`
- Modify: `packages/orchestrator/src/index.ts`

- [ ] **Step 1: Write the pair finder**

Create `packages/orchestrator/src/flow-json/find-fork-join-pairs.ts`:

```ts
import type { WorkflowGraph, WorkflowEdge } from "@journeyman/core";

export interface ForkJoinPair {
  forkId: string;
  joinId: string;
  /** Map of branchHeadNodeId → ordered list of node ids in that branch (excludes join). */
  branches: Map<string, string[]>;
}

export interface PairDetectionResult {
  pairs: ForkJoinPair[];
  /** Forks that could not be paired with a single join, with a reason. */
  unpairedForks: Array<{ forkId: string; reason: string }>;
  /** Joins that have no matching fork. */
  orphanJoins: string[];
}

/**
 * Detect Fork↔Join pairings in a graph by walking outgoing edges from each
 * `gateway-and` node. A valid pair: every branch from the fork must reach
 * exactly the same `join` node, and that join must have one incoming edge per
 * branch. Pure: no mutation, no I/O.
 */
export function findForkJoinPairs(graph: WorkflowGraph): PairDetectionResult {
  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, WorkflowEdge[]>();
  for (const e of graph.edges) {
    (outgoing.get(e.source) ?? outgoing.set(e.source, []).get(e.source)!).push(e);
    (incoming.get(e.target) ?? incoming.set(e.target, []).get(e.target)!).push(e);
  }
  const nodesById = new Map(graph.nodes.map(n => [n.id, n]));

  const pairs: ForkJoinPair[] = [];
  const unpairedForks: Array<{ forkId: string; reason: string }> = [];
  const pairedJoinIds = new Set<string>();

  for (const node of graph.nodes) {
    if (node.type !== "gateway-and") continue;

    const forkOuts = outgoing.get(node.id) ?? [];
    if (forkOuts.length < 2) {
      unpairedForks.push({ forkId: node.id, reason: "fewer than 2 outgoing branches" });
      continue;
    }

    const branches = new Map<string, string[]>();
    const joinCandidates = new Set<string>();
    let walkError: string | null = null;

    for (const e of forkOuts) {
      const path: string[] = [];
      let cur: string | null = e.target;
      const visited = new Set<string>();
      let joinHit: string | null = null;

      while (cur && !visited.has(cur)) {
        visited.add(cur);
        const curNode = nodesById.get(cur);
        if (!curNode) { walkError = `branch from ${node.id} references unknown node ${cur}`; break; }
        if (curNode.type === "join") { joinHit = cur; break; }
        if (curNode.type === "end") { walkError = `branch from ${node.id} reaches end ${cur} without a join`; break; }
        path.push(cur);
        const nextEdges = outgoing.get(cur) ?? [];
        // For non-gateway nodes we expect a single successor.
        if (nextEdges.length === 0) { walkError = `branch from ${node.id} terminates at ${cur} without a join`; break; }
        cur = nextEdges[0].target;
      }

      if (walkError) break;
      if (!joinHit) {
        walkError = `branch from ${node.id} starting at ${e.target} did not reach a join`;
        break;
      }
      joinCandidates.add(joinHit);
      branches.set(e.target, path);
    }

    if (walkError) {
      unpairedForks.push({ forkId: node.id, reason: walkError });
      continue;
    }
    if (joinCandidates.size !== 1) {
      unpairedForks.push({
        forkId: node.id,
        reason: `branches converge on multiple joins: ${[...joinCandidates].join(", ")}`,
      });
      continue;
    }
    const joinId = [...joinCandidates][0];

    // Every branch from the fork must contribute exactly one incoming edge to the join.
    const joinIncoming = incoming.get(joinId) ?? [];
    if (joinIncoming.length !== forkOuts.length) {
      unpairedForks.push({
        forkId: node.id,
        reason: `join ${joinId} has ${joinIncoming.length} incoming edges, expected ${forkOuts.length}`,
      });
      continue;
    }

    pairs.push({ forkId: node.id, joinId, branches });
    pairedJoinIds.add(joinId);
  }

  const orphanJoins = graph.nodes
    .filter(n => n.type === "join" && !pairedJoinIds.has(n.id))
    .map(n => n.id);

  return { pairs, unpairedForks, orphanJoins };
}
```

Notes:
- This helper deliberately rejects nested forks inside branches in v1 (the inner loop assumes a single successor on non-join non-end nodes). Nested handling lands in a follow-up — out of scope per the spec.
- Pure function; safe to call repeatedly from editor + validator + converter.

- [ ] **Step 2: Re-export from orchestrator index**

Add to `packages/orchestrator/src/index.ts`:

```ts
export { findForkJoinPairs } from "./flow-json/find-fork-join-pairs.ts";
export type { ForkJoinPair, PairDetectionResult } from "./flow-json/find-fork-join-pairs.ts";
```

---

## Task 4: `validateForkJoinPairs` in core

**Files:**
- Create: `packages/core/src/validation/validate-fork-join-pairs.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/validation/validate-for-publish.ts`

- [ ] **Step 1: Write the validator**

Create `packages/core/src/validation/validate-fork-join-pairs.ts`:

```ts
import type { WorkflowGraph } from "../types/flow.types.ts";
import type { JoinConfig, JoinErrorMode } from "../types/parallel.types.ts";

export interface ForkJoinPairError {
  nodeId: string;
  rule:
    | "fork-needs-join"
    | "join-needs-fork"
    | "branch-escapes-to-end"
    | "branches-converge-on-different-joins"
    | "join-incoming-mismatch"
    | "first-wins-non-pause-branch"
    | "shared-step-across-branches";
  message: string;
}

const PAUSE_NODE_TYPES = new Set(["human-task", "webhook-wait", "timer"]);

/**
 * Pair + topology validation for parallel fork/join. Does NOT call
 * `findForkJoinPairs` (which lives in orchestrator) to keep core dependency-free;
 * instead implements the same walk locally. Pure.
 */
export function validateForkJoinPairs(graph: WorkflowGraph): ForkJoinPairError[] {
  const errors: ForkJoinPairError[] = [];

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const e of graph.edges) {
    (outgoing.get(e.source) ?? outgoing.set(e.source, []).get(e.source)!).push(e.target);
    (incoming.get(e.target) ?? incoming.set(e.target, []).get(e.target)!).push(e.source);
  }
  const nodesById = new Map(graph.nodes.map(n => [n.id, n]));

  const forkIds = graph.nodes.filter(n => n.type === "gateway-and").map(n => n.id);
  const joinIds = graph.nodes.filter(n => n.type === "join").map(n => n.id);
  const pairedJoins = new Set<string>();
  const branchOwnership = new Map<string, string>(); // nodeId → forkId that owns it

  for (const forkId of forkIds) {
    const outs = outgoing.get(forkId) ?? [];
    if (outs.length < 2) {
      errors.push({
        nodeId: forkId,
        rule: "fork-needs-join",
        message: `Fork ${forkId} needs at least 2 outgoing branches.`,
      });
      continue;
    }

    const joinCandidates = new Set<string>();
    const branchPaths: Array<{ head: string; path: string[] }> = [];
    let escapedEnd = false;

    for (const head of outs) {
      const path: string[] = [];
      const visited = new Set<string>();
      let cur: string | null = head;
      let joinHit: string | null = null;

      while (cur && !visited.has(cur)) {
        visited.add(cur);
        const n = nodesById.get(cur);
        if (!n) break;
        if (n.type === "join") { joinHit = cur; break; }
        if (n.type === "end") {
          errors.push({
            nodeId: cur,
            rule: "branch-escapes-to-end",
            message: `Branch from fork ${forkId} reaches end ${cur} without a join.`,
          });
          escapedEnd = true;
          break;
        }
        path.push(cur);
        const nexts = outgoing.get(cur) ?? [];
        cur = nexts[0] ?? null;
      }

      if (joinHit) joinCandidates.add(joinHit);
      branchPaths.push({ head, path });
    }

    if (escapedEnd) continue;

    if (joinCandidates.size === 0) {
      errors.push({
        nodeId: forkId,
        rule: "fork-needs-join",
        message: `Fork ${forkId} has no branch that reaches a join.`,
      });
      continue;
    }
    if (joinCandidates.size > 1) {
      errors.push({
        nodeId: forkId,
        rule: "branches-converge-on-different-joins",
        message: `Fork ${forkId} branches converge on multiple joins: ${[...joinCandidates].join(", ")}.`,
      });
      continue;
    }
    const joinId = [...joinCandidates][0];
    const joinIncoming = incoming.get(joinId) ?? [];
    if (joinIncoming.length !== outs.length) {
      errors.push({
        nodeId: joinId,
        rule: "join-incoming-mismatch",
        message: `Join ${joinId} has ${joinIncoming.length} incoming edges; expected one per branch (${outs.length}).`,
      });
      continue;
    }

    // Record branch ownership; flag shared steps.
    for (const { path } of branchPaths) {
      for (const id of path) {
        const prior = branchOwnership.get(id);
        if (prior && prior !== forkId) {
          errors.push({
            nodeId: id,
            rule: "shared-step-across-branches",
            message: `Node ${id} appears in branches of multiple forks (${prior} and ${forkId}).`,
          });
        } else {
          branchOwnership.set(id, forkId);
        }
      }
    }

    pairedJoins.add(joinId);

    // first-wins restriction: every branch path must contain only pause-type nodes.
    const joinNode = nodesById.get(joinId);
    const joinCfg = (joinNode?.config ?? {}) as JoinConfig;
    const mode: JoinErrorMode = joinCfg.errorMode ?? "fail-fast";
    if (mode === "first-wins") {
      for (const { path } of branchPaths) {
        for (const id of path) {
          const n = nodesById.get(id);
          if (!n) continue;
          if (!PAUSE_NODE_TYPES.has(n.type)) {
            errors.push({
              nodeId: id,
              rule: "first-wins-non-pause-branch",
              message: `Node ${id} (${n.type}) cannot appear in a first-wins branch — only pause nodes (human-task, webhook-wait, timer) are allowed in v1.`,
            });
          }
        }
      }
    }
  }

  for (const joinId of joinIds) {
    if (!pairedJoins.has(joinId)) {
      errors.push({
        nodeId: joinId,
        rule: "join-needs-fork",
        message: `Join ${joinId} has no matching fork.`,
      });
    }
  }

  return errors;
}
```

- [ ] **Step 2: Re-export from `packages/core/src/index.ts`**

```ts
export { validateForkJoinPairs } from "./validation/validate-fork-join-pairs.ts";
export type { ForkJoinPairError } from "./validation/validate-fork-join-pairs.ts";
```

- [ ] **Step 3: Wire into the publish gate**

Open `packages/core/src/validation/validate-for-publish.ts`. Find the function that returns `PublishValidationResult`. Import the new validator and merge its errors:

```ts
import { validateForkJoinPairs } from "./validate-fork-join-pairs.ts";
// …
const pairErrors = validateForkJoinPairs(graph);
for (const e of pairErrors) {
  errors.push({
    nodeId: e.nodeId,
    code: e.rule,
    message: e.message,
  });
}
```

Adapt the `errors.push` shape to whatever `PublishError` actually expects in this file (read the existing push sites and mirror them). The point is: pair-rule violations block publish.

---

## Task 5: Conductor types — extend `JoinTask.inputParameters`

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-types.ts`

- [ ] **Step 1: Extend the `JoinTask` interface**

```ts
export interface JoinTask {
  type: "JOIN";
  name: string;
  taskReferenceName: string;
  joinOn: string[];
  inputParameters?: {
    /** Error / completion mode resolved from the Join node config. */
    errorMode?: "fail-fast" | "wait-all" | "wait-all-strict" | "first-wins";
    /**
     * For first-wins: every branch's full task-reference-name list. The
     * first-wins controller uses this to know which sibling tasks to cancel
     * when a winner is determined.
     */
    branchTaskRefs?: string[][];
    /** Optional Join node description, surfaced in run-viewer tooltips. */
    description?: string;
  };
}
```

---

## Task 6: Converter — rewrite `emitForkJoin` for explicit pair + add `emitJoin`

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`

- [ ] **Step 1: Add `"join"` to the dispatch switch**

Find the `switch (node.type)` block (around line 200). Add:

```ts
case "gateway-and":  return this.emitForkJoin(node);
case "join":         return this.emitJoin(node);
```

- [ ] **Step 2: Rewrite `emitForkJoin`**

Replace the existing `emitForkJoin` body (the one at line ~393) with this:

```ts
emitForkJoin(node: WorkflowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
  const outs = this.outsOf(node.id);
  if (outs.length < 2) {
    throw new WorkflowValidationError(`Fork ${this.label(node)} must have at least 2 outgoing edges`);
  }

  // Walk each branch until we hit the paired join. The join MUST be present
  // and identical across branches — enforced by validateForkJoinPairs upstream,
  // but we re-check here to fail loudly at convert time.
  const joinIds = new Set<string>();
  const branches: Array<{ head: string; stopAt: Set<string> }> = [];
  for (const e of outs) {
    const join = this.findJoinAlongBranch(e.target);
    if (!join) {
      throw new WorkflowValidationError(`Fork ${this.label(node)} branch starting at ${e.target} does not reach a join`);
    }
    joinIds.add(join);
    branches.push({ head: e.target, stopAt: new Set([join]) });
  }
  if (joinIds.size !== 1) {
    throw new WorkflowValidationError(
      `Fork ${this.label(node)} branches converge on multiple joins: ${[...joinIds].join(", ")}`,
    );
  }
  const joinId = [...joinIds][0];

  const forkTasks: ConductorTaskDef[][] = branches.map(b => this.buildSequence(b.head, b.stopAt));

  const fork: ForkJoinTask = {
    type: "FORK_JOIN",
    name: `fork_${node.id}`,
    taskReferenceName: node.id,
    forkTasks,
  };
  // Mark the fork as the "current emission" — the join node itself is the
  // next node to emit, which will append the JOIN task.
  return { tasks: [fork], nextNodeId: joinId };
}

private findJoinAlongBranch(start: string): string | null {
  const visited = new Set<string>();
  let cur: string | null = start;
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const n = this.nodes.get(cur);
    if (!n) return null;
    if (n.type === "join") return cur;
    const nexts = this.outgoing.get(cur) ?? [];
    cur = nexts[0]?.target ?? null;
  }
  return null;
}
```

Notes:
- `emitForkJoin` no longer emits the JOIN task itself; it stops at the join and lets `emitJoin` handle it. This keeps the JOIN as a real node with the join node's id as its `taskReferenceName`.
- `nextNodeId` is the join id, so the converter's main loop will call `emitJoin` next.

- [ ] **Step 3: Add `emitJoin`**

Immediately after `emitForkJoin`, add:

```ts
emitJoin(node: WorkflowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
  const ins = this.flow.edges.filter(e => e.target === node.id);
  if (ins.length < 2) {
    throw new WorkflowValidationError(`Join ${this.label(node)} must have at least 2 incoming edges`);
  }

  // Find the matching fork by walking backwards from any branch's last node:
  // the join's incoming sources are each branch's last node. We need the
  // taskReferenceName of each — which equals the source node id.
  const joinOn = ins.map(e => e.source);

  // Locate the matching fork node so we can build branchTaskRefs for first-wins.
  // The matching fork is the unique gateway-and whose branches all reach this join.
  const fork = this.findMatchingFork(node.id);
  if (!fork) {
    throw new WorkflowValidationError(`Join ${this.label(node)} has no matching fork`);
  }

  const cfg = (node.config ?? {}) as Partial<import("@journeyman/core").JoinConfig>;
  const errorMode = cfg.errorMode ?? "fail-fast";

  // For first-wins, gather each branch's full chain of node ids so the
  // controller can cancel paused tasks in losing branches.
  const branchTaskRefs: string[][] = (this.outgoing.get(fork) ?? []).map(e => {
    const chain: string[] = [];
    let cur: string | null = e.target;
    const visited = new Set<string>();
    while (cur && !visited.has(cur) && cur !== node.id) {
      visited.add(cur);
      chain.push(cur);
      cur = (this.outgoing.get(cur) ?? [])[0]?.target ?? null;
    }
    return chain;
  });

  const join: JoinTask = {
    type: "JOIN",
    name: `join_${node.id}`,
    taskReferenceName: node.id,
    joinOn,
    inputParameters: {
      errorMode,
      branchTaskRefs,
      ...(cfg.description ? { description: cfg.description } : {}),
    },
  };

  return { tasks: [join], nextNodeId: this.successor(node.id) };
}

private findMatchingFork(joinId: string): string | null {
  for (const node of this.flow.nodes) {
    if (node.type !== "gateway-and") continue;
    const branchHeads = (this.outgoing.get(node.id) ?? []).map(e => e.target);
    const allReach = branchHeads.every(head => {
      const visited = new Set<string>();
      let cur: string | null = head;
      while (cur && !visited.has(cur)) {
        visited.add(cur);
        if (cur === joinId) return true;
        const nexts = this.outgoing.get(cur) ?? [];
        cur = nexts[0]?.target ?? null;
      }
      return false;
    });
    if (allReach && branchHeads.length >= 2) return node.id;
  }
  return null;
}
```

---

## Task 7: First-wins controller

**Files:**
- Create: `packages/orchestrator/src/sync/first-wins-controller.ts`
- Modify: `packages/orchestrator/src/index.ts`

- [ ] **Step 1: Write the controller**

Create `packages/orchestrator/src/sync/first-wins-controller.ts`:

```ts
import type { ConductorClient } from "../engines/conductor/conductor-client.ts";

/**
 * Inspect a workflow's tasks. For every JOIN task whose `inputParameters.errorMode`
 * is "first-wins" and whose status is still IN_PROGRESS:
 *   - find the first branch whose terminal task has status COMPLETED (success)
 *   - mark the JOIN as completed by signalling the first branch's terminal task
 *     as the join's resolution input (Conductor's standard JOIN behavior will
 *     pick up the first arrival)
 *   - for every OTHER branch's still-in-progress task, post a CANCELLED
 *     completion via Conductor's task-update API
 *
 * Idempotent: safe to call on every reconcile pass. Pure observer — no DB
 * writes. Returns the list of cancelled task refs for logging.
 */
export async function applyFirstWinsCancellation(
  conductor: ConductorClient,
  engineWorkflowId: string,
): Promise<{ cancelled: string[] }> {
  const wf = await conductor.getWorkflowWithTasks(engineWorkflowId);
  const cancelled: string[] = [];

  const joins = (wf.tasks ?? []).filter(t =>
    t.taskType === "JOIN" && t.status === "IN_PROGRESS",
  );

  for (const join of joins) {
    const params = (join.inputData ?? join.inputParameters ?? {}) as {
      errorMode?: string;
      branchTaskRefs?: string[][];
    };
    if (params.errorMode !== "first-wins") continue;
    const branches = params.branchTaskRefs ?? [];
    if (branches.length < 2) continue;

    // Identify the winning branch (the one whose terminal node id appears in
    // joinOn with a COMPLETED status).
    const completedTerminals = new Set(
      (wf.tasks ?? [])
        .filter(t => t.status === "COMPLETED" && (join.joinOn ?? []).includes(t.referenceTaskName ?? ""))
        .map(t => t.referenceTaskName),
    );
    if (completedTerminals.size === 0) continue;

    const winningBranchIdx = branches.findIndex(chain => {
      const terminal = chain[chain.length - 1];
      return terminal && completedTerminals.has(terminal);
    });
    if (winningBranchIdx < 0) continue;

    // For every losing branch, cancel any IN_PROGRESS task.
    for (let i = 0; i < branches.length; i++) {
      if (i === winningBranchIdx) continue;
      for (const nodeId of branches[i]) {
        const task = (wf.tasks ?? []).find(t => t.referenceTaskName === nodeId);
        if (!task) continue;
        if (task.status !== "IN_PROGRESS" && task.status !== "SCHEDULED") continue;
        try {
          await conductor.completeTask({
            workflowInstanceId: engineWorkflowId,
            taskId: task.taskId,
            status: "CANCELED",
            outputData: { cancelledBy: "first-wins-controller", joinTaskRef: join.referenceTaskName },
          });
          cancelled.push(nodeId);
        } catch {
          // Swallow — the task may have just transitioned. Idempotency wins.
        }
      }
    }
  }

  return { cancelled };
}
```

Notes:
- The `conductor.completeTask` call signature must match the existing `ConductorClient`. If the method name is different (e.g. `updateTask`, `postTaskResult`), grep `engines/conductor/conductor-client.ts` and adapt the call.
- If `getWorkflowWithTasks` returns differently-shaped tasks (no `inputData`/`inputParameters` field), adapt the destructure. The intent is unchanged.

- [ ] **Step 2: Re-export**

In `packages/orchestrator/src/index.ts`:

```ts
export { applyFirstWinsCancellation } from "./sync/first-wins-controller.ts";
```

---

## Task 8: Wire the controller into the api-server reconcile loop

**Files:**
- Modify: `packages/api-server/src/services/engine-reconciler.ts`

- [ ] **Step 1: Invoke after the HUMAN-task reconciliation block**

At the bottom of `reconcileWorkflowInstance` (after the existing HUMAN loop, before the `setStatus("paused")` call), add:

```ts
try {
  await applyFirstWinsCancellation(c.conductorClient, workflowInstance.engineWorkflowId);
} catch {
  // Best-effort — never let cancellation failure break reconciliation.
}
```

Add the import at the top:

```ts
import { applyFirstWinsCancellation } from "@journeyman/orchestrator";
```

---

## Task 9: Canvas — Fork tile redesign + Join tile + registry + edge highlight

**Files:**
- Modify: `packages/flow-editor/src/canvas/nodes/GatewayAndNode.tsx`
- Create: `packages/flow-editor/src/canvas/nodes/JoinNode.tsx`
- Modify: `packages/flow-editor/src/canvas/node-registry.ts`
- Create: `packages/flow-editor/src/canvas/edge-highlighting.ts`
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx`

- [ ] **Step 1: Replace `GatewayAndNode.tsx`**

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";

export interface GatewayAndNodeData {
  displayName?: string;
  branchCount?: number;
  [key: string]: unknown;
}

export function GatewayAndNode(props: NodeProps) {
  const data = props.data as GatewayAndNodeData;
  return (
    <div className="je-node je-node--gateway je-node--and">
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__icon">+</div>
      <div className="je-node__text">
        <div className="je-node__label">{data.displayName ?? "Fork"}</div>
        {typeof data.branchCount === "number" && data.branchCount > 0 && (
          <div className="je-node__subtitle">× {data.branchCount}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="default" style={handleBlue} />
    </div>
  );
}
```

- [ ] **Step 2: Create `JoinNode.tsx`**

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";

export interface JoinNodeData {
  displayName?: string;
  config?: { errorMode?: "fail-fast" | "wait-all" | "wait-all-strict" | "first-wins" };
  pendingBranches?: number;
  [key: string]: unknown;
}

const MODE_LABEL: Record<string, string> = {
  "fail-fast": "fail-fast",
  "wait-all": "wait-all",
  "wait-all-strict": "wait-all (strict)",
  "first-wins": "first-wins",
};

export function JoinNode(props: NodeProps) {
  const data = props.data as JoinNodeData;
  const mode = data.config?.errorMode ?? "fail-fast";
  return (
    <div className="je-node je-node--gateway je-node--join">
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__icon">⋈</div>
      <div className="je-node__text">
        <div className="je-node__label">{data.displayName ?? "Join"}</div>
        <div className="je-node__subtitle">{MODE_LABEL[mode]}</div>
      </div>
      <Handle type="source" position={Position.Right} id="default" style={handleBlue} />
    </div>
  );
}
```

- [ ] **Step 3: Register in `node-registry.ts`**

```ts
import { GatewayAndNode } from "./nodes/GatewayAndNode.tsx";
import { JoinNode } from "./nodes/JoinNode.tsx";
// …
export const nodeTypes = {
  // …
  "gateway-and": GatewayAndNode,
  "join": JoinNode,
  // …
};
```

- [ ] **Step 4: Edge-highlighting helper**

Create `packages/flow-editor/src/canvas/edge-highlighting.ts`:

```ts
import type { WorkflowGraph } from "@journeyman/core";

/**
 * Return the set of edge ids that belong to the Fork/Join pair containing
 * `selectedNodeId`. Returns an empty set if the selected node is not part of
 * any pair. Pure.
 */
export function edgesForForkJoinPair(graph: WorkflowGraph, selectedNodeId: string | null): Set<string> {
  if (!selectedNodeId) return new Set();
  const node = graph.nodes.find(n => n.id === selectedNodeId);
  if (!node) return new Set();
  if (node.type !== "gateway-and" && node.type !== "join") return new Set();

  // Walk from the fork (or backwards from the join to find the fork).
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const e of graph.edges) {
    (outgoing.get(e.source) ?? outgoing.set(e.source, []).get(e.source)!).push(e.target);
    (incoming.get(e.target) ?? incoming.set(e.target, []).get(e.target)!).push(e.source);
  }

  let forkId: string | null = null;
  let joinId: string | null = null;
  if (node.type === "gateway-and") {
    forkId = node.id;
    // join is reached from any branch.
    const head = (outgoing.get(forkId) ?? [])[0];
    let cur: string | null = head ?? null;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const n = graph.nodes.find(x => x.id === cur);
      if (n?.type === "join") { joinId = cur; break; }
      cur = (outgoing.get(cur) ?? [])[0] ?? null;
    }
  } else {
    joinId = node.id;
    // Walk backwards from any incoming edge until a gateway-and.
    let cur: string | null = (incoming.get(joinId) ?? [])[0] ?? null;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const n = graph.nodes.find(x => x.id === cur);
      if (n?.type === "gateway-and") { forkId = cur; break; }
      cur = (incoming.get(cur) ?? [])[0] ?? null;
    }
  }

  if (!forkId || !joinId) return new Set();

  // Collect all edges on any path from fork to join.
  const out = new Set<string>();
  const stack: string[] = [forkId];
  const visited = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    if (cur === joinId) continue;
    for (const e of graph.edges.filter(x => x.source === cur)) {
      out.add(e.id);
      stack.push(e.target);
    }
  }
  // Include the inbound edges into the join.
  for (const e of graph.edges.filter(x => x.target === joinId)) out.add(e.id);
  return out;
}
```

- [ ] **Step 5: Use it in `Canvas.tsx`**

Open `packages/flow-editor/src/canvas/Canvas.tsx`. Find where the React Flow edge style/className is computed per render (likely a `useMemo` over `edges` and `selection`). Import the helper and add a `highlighted` className when the edge id is in the set:

```tsx
import { edgesForForkJoinPair } from "./edge-highlighting.ts";
// …
const highlightedEdgeIds = useMemo(
  () => edgesForForkJoinPair(flow, selectedNodeId ?? null),
  [flow, selectedNodeId],
);
const decoratedEdges = edges.map(e => ({
  ...e,
  className: [e.className, highlightedEdgeIds.has(e.id) ? "je-edge--pair-highlight" : ""]
    .filter(Boolean).join(" "),
}));
```

Pass `decoratedEdges` to `<ReactFlow edges={…}/>` instead of `edges`. If `selectedNodeId` is not currently tracked in `Canvas.tsx`, derive it from `useNodes()` or the existing selection prop — match the surrounding pattern.

Add a CSS rule somewhere already loaded by the editor (e.g. the editor's main stylesheet) — exact file decided during work:

```css
.je-edge--pair-highlight path { stroke-width: 3px; }
```

---

## Task 10: Validation state — call `validateForkJoinPairs`

**Files:**
- Modify: `packages/flow-editor/src/state/validation.ts`

- [ ] **Step 1: Import and call**

At the top of the file:

```ts
import { validateForkJoinPairs } from "@journeyman/core";
```

In the validation function, after the existing per-node loop:

```ts
for (const e of validateForkJoinPairs(flow)) {
  errors.push(`${e.message}`);
}
```

(If the existing `errors.push` carries structured info like `{nodeId, message}`, push that shape instead. Mirror the surrounding style.)

Also remove the now-redundant inline check:

```ts
if (n.type === "gateway-and") {
  if ((out.get(n.id) ?? 0) < 2) errors.push(`gateway-and ${nodeLabel(n)} needs at least 2 branches`);
}
```

`validateForkJoinPairs` covers it.

---

## Task 11: Palette — drop coming-soon; add Join

**Files:**
- Modify: `packages/flow-editor/src/palette/built-in-categories.ts`

- [ ] **Step 1: Update entries**

Replace the existing `gateway-and` entry and add `join`:

```ts
{ nodeType: "gateway-and",   label: "Fork (parallel)",  category: "Logic",    color: "#00b894", icon: "+",  description: "Split flow into parallel branches" },
{ nodeType: "join",          label: "Join",             category: "Logic",    color: "#00b894", icon: "⋈",  description: "Wait for parallel branches; choose how to handle errors" },
```

(Remove `comingSoon: true` from the `gateway-and` line.)

---

## Task 12: Properties — Fork + Join editors and dispatch

**Files:**
- Create: `packages/flow-editor/src/properties-panel/ForkConfigEditor.tsx`
- Create: `packages/flow-editor/src/properties-panel/JoinConfigEditor.tsx`
- Modify: `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx`
- Modify: `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`

- [ ] **Step 1: Create `ForkConfigEditor.tsx`**

```tsx
import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";

interface Props {
  flow: WorkflowGraph;
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

export function ForkConfigEditor({ flow, node, onChange, readOnly }: Props) {
  const cfg = (node.config ?? {}) as { description?: string };
  const branchCount = flow.edges.filter(e => e.source === node.id).length;

  return (
    <div className="je-tab je-tab--config">
      <div className="je-field">
        <label className="je-field__label">Description</label>
        <textarea
          rows={2}
          value={cfg.description ?? ""}
          disabled={readOnly}
          placeholder="What this fork does, for future readers."
          onChange={e => onChange({ ...node, config: { ...cfg, description: e.target.value || undefined } })}
        />
      </div>
      <div className="je-field">
        <label className="je-field__label">Branches</label>
        <p className="je-hint">{branchCount} outgoing branch{branchCount === 1 ? "" : "es"}. Each runs in parallel until reaching the paired Join.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `JoinConfigEditor.tsx`**

```tsx
import type { WorkflowGraph, WorkflowNode, JoinErrorMode } from "@journeyman/core";

interface Props {
  flow: WorkflowGraph;
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

const MODE_OPTIONS: Array<{ value: JoinErrorMode; label: string; desc: string }> = [
  { value: "fail-fast", label: "Fail fast", desc: "First branch error cancels the others and fails the workflow." },
  { value: "wait-all", label: "Wait for all", desc: "Let every branch finish. Workflow fails only if all branches failed." },
  { value: "wait-all-strict", label: "Wait for all (strict)", desc: "Let every branch finish. Workflow fails if any branch failed." },
  { value: "first-wins", label: "First wins", desc: "First branch to succeed wins; others are cancelled. v1: branches must contain only pause nodes (human-task, webhook-wait, timer)." },
];

export function JoinConfigEditor({ flow, node, onChange, readOnly }: Props) {
  const cfg = (node.config ?? {}) as { errorMode?: JoinErrorMode; description?: string };
  const mode: JoinErrorMode = cfg.errorMode ?? "fail-fast";
  const incomingBranches = flow.edges.filter(e => e.target === node.id).length;

  const update = (patch: Partial<typeof cfg>) => onChange({ ...node, config: { ...cfg, ...patch } });

  return (
    <div className="je-tab je-tab--config">
      <div className="je-field">
        <label className="je-field__label">Error mode</label>
        <select
          value={mode}
          disabled={readOnly}
          onChange={e => update({ errorMode: e.target.value as JoinErrorMode })}
        >
          {MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <p className="je-hint">{MODE_OPTIONS.find(o => o.value === mode)?.desc}</p>
      </div>
      {mode === "first-wins" && (
        <div className="je-field je-hint--warn">
          <strong>v1 restriction:</strong> first-wins branches may contain only pause nodes (human-task, webhook-wait, timer).
          Step nodes are not allowed and will be flagged in validation.
        </div>
      )}
      <div className="je-field">
        <label className="je-field__label">Description</label>
        <textarea
          rows={2}
          value={cfg.description ?? ""}
          disabled={readOnly}
          placeholder="What this join is waiting for."
          onChange={e => update({ description: e.target.value || undefined })}
        />
      </div>
      <div className="je-field">
        <label className="je-field__label">Incoming branches</label>
        <p className="je-hint">{incomingBranches} incoming branch{incomingBranches === 1 ? "" : "es"}.</p>
      </div>
      <div className="je-field">
        <label className="je-field__label">Output shape</label>
        <pre className="je-code-block">{outputShapeFor(mode)}</pre>
      </div>
    </div>
  );
}

function outputShapeFor(mode: JoinErrorMode): string {
  if (mode === "fail-fast") return "// no Join-level output; reference branch nodes by id, e.g. stepA.field";
  if (mode === "first-wins") return JSON.stringify({ winner: "<branchHeadNodeId>", output: "<winning branch's last node output>" }, null, 2);
  return JSON.stringify({ results: { "<branchHeadNodeId>": { status: "success | error | cancelled", output: "<…>" } } }, null, 2);
}
```

- [ ] **Step 3: Dispatch in `ControlNodeConfigTab.tsx`**

Below the existing `human-task` / `webhook-wait` dispatches:

```tsx
if (node.type === "gateway-and") {
  return <ForkConfigEditor flow={flow} node={node} onChange={onChange} readOnly={readOnly} />;
}
if (node.type === "join") {
  return <JoinConfigEditor flow={flow} node={node} onChange={onChange} readOnly={readOnly} />;
}
```

Add imports at the top:

```tsx
import { ForkConfigEditor } from "./ForkConfigEditor.tsx";
import { JoinConfigEditor } from "./JoinConfigEditor.tsx";
```

- [ ] **Step 4: Include the new types in `PropertiesPanel.tsx`**

Find the existing control-node branch:

```tsx
) : node.type === "loop" || node.type === "timer" || node.type === "human-task" || node.type === "webhook-wait" ? (
```

Add the two new types:

```tsx
) : node.type === "loop" || node.type === "timer" || node.type === "human-task" || node.type === "webhook-wait" || node.type === "gateway-and" || node.type === "join" ? (
```

---

## Task 13: Run-viewer — recognize new node types + cancelled state

**Files:**
- Audit: `packages/run-viewer/src/`

- [ ] **Step 1: Locate the run-viewer's node-type switch**

Run:

```bash
grep -rEn "human-task|gateway-xor|step" packages/run-viewer/src --include='*.ts' --include='*.tsx' | head -30
```

Find the file that maps node type → live display.

- [ ] **Step 2: Add `gateway-and` and `join` handling**

In whichever file renders per-node tiles in the read-only run canvas, mirror the editor's `GatewayAndNode` and `JoinNode` visuals (or just reuse the editor components if already imported). The key additions:

- `gateway-and` tile shows `running` while any of its branch's nodes are still in `running` or `waiting`.
- `join` tile shows `waiting` with text "N of M complete" while any incoming branch hasn't reported a terminal status; otherwise mirrors the workflow result.

- [ ] **Step 3: Render `cancelled` status visual**

Find the run-viewer's status → CSS class mapping. Add `cancelled` if not already present:

```ts
const STATUS_CLASS: Record<string, string> = {
  // …
  cancelled: "je-node--cancelled",
};
```

Add a CSS rule:

```css
.je-node--cancelled { opacity: 0.45; filter: grayscale(0.6); }
```

If the run-viewer currently maps unknown statuses to a default, this is purely additive — no behavior change for existing statuses.

---

## Task 14: Audit remaining `gateway-and` / `join` references

**Files:** none directly; audit-only.

- [ ] **Step 1: Grep**

```bash
grep -rEn '"gateway-and"|"join"' packages --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v dist | grep -v ".test."
```

For each hit, confirm:
- Editor / canvas / palette / properties usages are covered by earlier tasks.
- Backend converter / matcher / reconciler usages are covered.
- Validators and catalog files are aware of the new types.

For any uncovered hit, add parallel handling alongside neighbouring node-type branches.

- [ ] **Step 2: Confirm the converter's dispatch is exhaustive**

In `packages/orchestrator/src/flow-json/conductor-converter.ts`, confirm the `switch (node.type)` block matches every node type that can appear post-validation. Both `gateway-and` and `join` must be routed; `retry-block` and `try-catch` still throw `UnsupportedNodeTypeError` as before.

---

## Task 15: Final typecheck

**Files:** none.

- [ ] **Step 1: Run repo-wide check**

```bash
npm run check
```

Expected: clean exit (0).

- [ ] **Step 2: Fix any errors in place**

Common likely failures and what to look for:
- **"Property 'errorMode' does not exist on type 'JoinConfig'"** — import path wrong on the consumer; should be `@journeyman/core`.
- **"Type 'string' is not assignable to type 'JoinErrorMode'"** — a dropdown or default value passes a literal; cast or narrow it.
- **"Argument of type 'NodeProps' …"** — React-Flow version mismatch on the new tiles; mirror the typing pattern used by neighbouring tile components.
- **Import boundary error** referencing `@journeyman/orchestrator` from `@journeyman/core` — should never happen; `validateForkJoinPairs` is in core and re-implements the walk locally (does NOT import from orchestrator). If it slipped, refactor to remove the dependency.

Re-run `npm run check` until clean.

---

## Self-Review Notes

Spec coverage:
- Two new node types — Tasks 1, 2, 9, 12.
- Topology validation rules — Task 4.
- 4-mode Join with `first-wins` pause-only restriction — Tasks 2, 4, 6, 7, 12.
- Converter explicit-pair rewrite — Task 6.
- First-wins controller — Tasks 7, 8.
- Canvas + edge highlighting + palette — Tasks 9, 11.
- Properties panel — Task 12.
- Run-viewer — Task 13.

Type-consistency check:
- `JoinErrorMode` defined once in `parallel.types.ts` and used in: converter (Task 5/6), validator (Task 4), join editor (Task 12), join tile (Task 9), run-viewer (Task 13), first-wins controller (Task 7).
- `JoinConfig.errorMode` defaults to `"fail-fast"` everywhere it's read.
- `branchTaskRefs` shape (string[][]) defined in `JoinTask.inputParameters` (Task 5) and consumed by `applyFirstWinsCancellation` (Task 7).

Deferred (per spec):
- `first-wins` with running-step branches.
- Branch retry as a join-level concept.
- Dynamic fork.
- N-of-M completion.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-24-parallel-fork-join.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
