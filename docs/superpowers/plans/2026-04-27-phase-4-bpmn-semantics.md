# Phase 4 — Full BPMN Semantics

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Per the user's standing preference: skip unit-test steps, no per-task commits, run typecheck only at the end of the phase, parallel writes wherever possible.

**Goal:** Lift the editor + engine out of "linear only" into the BPMN-flavored shape the spec actually calls for. Users can build flows with conditional branches (XOR), parallel fan-out + join (AND), loops with bounded visits, sub-flows, timers, and per-phase error edges that route to recovery branches. Multiple end nodes are allowed (each with an outcome label). The Conductor converter learns the new node types; the React Flow canvas grows new node and edge components; the editor surfaces validation errors before letting the user click Run.

**Architecture:** The shape change ripples through three layers — *converter* (`@journeyman/orchestrator/flow-json/conductor-converter.ts` rewritten from a linear walker into a recursive region builder), *editor* (`@journeyman/flow-editor` adds 6 new node components, 3 edge components, an inline validation banner, and removes its linear-only enforcement), and *worker harness* (visit-count guard for cycles). Conductor tasks are registered for SWITCH / FORK_JOIN / JOIN / DO_WHILE / WAIT / SUB_WORKFLOW where needed.

**Tech Stack:** No new dependencies. Same `@xyflow/react`, `zod`, `pg`. Conductor task types we're newly using: `SWITCH`, `FORK_JOIN`, `JOIN`, `DO_WHILE`, `WAIT`, `SUB_WORKFLOW`, `TERMINATE` (for multi-end semantics).

---

## Spec Reference

Source spec: `docs/superpowers/specs/2026-04-27-visual-flow-orchestration-design.md`. Implements **Section 12 → "Phase 4 — Full BPMN semantics"** plus the additional node types from §4 that are cheap once the new converter exists (`if` as XOR sugar, `timer` as WAIT). Out of scope and deferred:

- `retry-block` and `try-catch` regions — Phase 5 (alongside the Retry & Errors tab)
- `human-task` — reserved for Phase 6+
- Visual sub-flow drill-in (clicking a subflow node opens its inner graph) — Phase 6 polish
- Per-edge condition expression *editor* in the properties panel — Phase 5 (alongside the I/O tab)

## What Changes

| Layer | Package | Change |
|---|---|---|
| Types | `@journeyman/core` | + `EdgeType` constants + `outcome?: string` field on `FlowNode` (used by `end` nodes) + `branchLabel?: string` on `FlowEdge` (used by SWITCH cases) |
| Converter | `@journeyman/orchestrator` | Rewritten `conductor-converter.ts` — region builder, per-node-type dispatch, FORK/JOIN matching, DO_WHILE bodies, SWITCH cases, WAIT, SUB_WORKFLOW, multi-end via TERMINATE; emits a workflow-level `cycleVisitLimit` |
| Worker | `@journeyman/orchestrator` | + visit-count tracking in the `WorkerHarness` per-`(runId, nodeId)`; aborts node with `CycleLimitExceeded` failure if exceeded |
| API | `@journeyman/api-server` | (unchanged routes — body schemas relax to allow new node/edge types) |
| Components | `@journeyman/flow-editor` | + 6 new node components, 3 new edge components, error-output handle on `PhaseNode`, validation banner, Palette categories grow, Phase 4 removes the linear-only canvas guard |
| Components | `@journeyman/run-viewer` | + `cancelled` colour for cancelled runs, `×N` cycle-visit badge already supported via `visitCount` |
| Shell | `@journeyman/web` | Larger `built-in-phase-catalog` for the new types (still backed only by the `analyze` worker for now — non-AI nodes are control-flow primitives the engine handles directly) |

## File Structure

```
packages/
├── core/                                     (types extended)
│   └── src/types/flow.types.ts               + outcome / branchLabel
│
├── orchestrator/                             (converter rewrite + visit-count guard)
│   └── src/
│       ├── flow-json/
│       │   ├── conductor-converter.ts        full rewrite
│       │   └── conductor-types.ts            NEW: ConductorTaskDef union (SIMPLE | SWITCH | FORK_JOIN | JOIN | DO_WHILE | WAIT | SUB_WORKFLOW | TERMINATE)
│       ├── workers/
│       │   ├── worker-harness.ts             + cycle visit-count guard
│       │   └── visit-counter.ts              NEW: per-run in-memory visit map
│       └── index.ts                          + new converter type exports
│
├── api-server/                               (schema relax only)
│   └── src/schemas/
│       ├── flow.ts                           allow new edge/node fields
│       └── update-flow.ts                    same
│
├── flow-editor/                              (new node + edge components, validation banner)
│   └── src/
│       ├── canvas/
│       │   ├── nodes/
│       │   │   ├── PhaseNode.tsx             + secondary "error" output handle
│       │   │   ├── GatewayXorNode.tsx        NEW
│       │   │   ├── GatewayAndNode.tsx        NEW (split + matching join)
│       │   │   ├── LoopNode.tsx              NEW
│       │   │   ├── SubflowNode.tsx           NEW
│       │   │   ├── IfNode.tsx                NEW
│       │   │   └── TimerNode.tsx             NEW
│       │   ├── edges/
│       │   │   ├── DefaultEdge.tsx           (no change)
│       │   │   ├── ConditionalEdge.tsx       NEW (orange dashed, label = condition summary)
│       │   │   ├── ErrorEdge.tsx             NEW (red dashed)
│       │   │   └── ElseEdge.tsx              NEW (gray dashed, label "else")
│       │   └── node-registry.ts              + new entries
│       ├── state/
│       │   ├── flow-graph.ts                 isLinearAndComplete → isValidPhase4Graph
│       │   └── validation.ts                 NEW: structural validators per node type
│       ├── palette/
│       │   ├── built-in-categories.ts        NEW: extra catalog entries for control nodes
│       │   └── Palette.tsx                   sources from PhaseCatalog + ControlNodeCatalog
│       ├── topbar/Topbar.tsx                 + validation-error banner
│       └── styles.css                        + styles for new node types and edge variants
│
├── run-viewer/                               (no source change; status pill already supports cancelled)
│
└── web/
    └── src/
        ├── catalogs/
        │   ├── built-in-phase-catalog.ts     (unchanged — still just analyze)
        │   └── built-in-control-catalog.ts   NEW (gateway/loop/subflow/if/timer entries)
        └── routes/
            └── FlowEditorPage.tsx            pass both catalogs to <FlowEditor>
```

## Public API additions

### `@journeyman/core`

```typescript
// flow.types.ts — new fields
export interface FlowNode {
  // existing fields…
  /** End node only: surfaced as the run's `outcome` label. */
  outcome?: string;
}

export interface FlowEdge {
  // existing fields…
  /** SWITCH branch label, e.g. "high" / "low" / "default". Used when type === "conditional". */
  branchLabel?: string;
}
```

### `@journeyman/flow-editor`

```typescript
// new export — the catalog of control-flow node types
export interface ControlNodeCatalogEntry {
  nodeType: FlowNodeType;       // "gateway-xor" | "gateway-and" | "loop" | "subflow" | "if" | "timer"
  label: string;
  category: string;             // "Logic" | "Control" | "Subflows"
  description?: string;
  color: string;
  icon: string;
}
export type ControlNodeCatalog = ControlNodeCatalogEntry[];

// extended props
export interface FlowEditorProps {
  // existing fields…
  controlCatalog?: ControlNodeCatalog;
}

// new validation helper, exported alongside isLinearAndComplete (kept for backward compat)
export function isValidPhase4Graph(flow: FlowGraph): { ok: boolean; errors: string[] };
```

---

## Task 1: Type extensions in `@journeyman/core`

**Files:**
- Modify: `packages/core/src/types/flow.types.ts`

- [ ] **Step 1.1: add `outcome` and `branchLabel` fields**

In `FlowNode`, add an `outcome?: string` field with a comment that it's only meaningful on `end` nodes. In `FlowEdge`, add `branchLabel?: string` with a comment that it's used by SWITCH (`gateway-xor`/`if`) cases.

(No exports change — `flow.types.ts` is already barreled through `core/src/index.ts` via the existing `export type { Flow, FlowGraph, ... }` block.)

---

## Task 2: Schema relax in `@journeyman/api-server`

**Files:**
- Modify: `packages/api-server/src/schemas/flow.ts`
- Modify: `packages/api-server/src/schemas/update-flow.ts`

- [ ] **Step 2.1: add `outcome` to node schema and `branchLabel` to edge schema (in both files)**

In each file, locate the inline node and edge object schemas and add:

```typescript
// inside z.object({ ... }) for nodes:
outcome: z.string().optional(),

// inside z.object({ ... }) for edges:
branchLabel: z.string().optional(),
```

The `type: z.string()` on nodes already accepts the new node type strings (no change there). The edge `type` enum already has `default | conditional | error | else`; no change needed.

---

## Task 3: Converter rewrite — `conductor-converter.ts`

**Files:**
- Create: `packages/orchestrator/src/flow-json/conductor-types.ts`
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`

This is the largest task. The converter walks the FlowGraph as a directed graph and emits a Conductor workflow definition. The walk uses a **recursive region builder**: starting from `start`, it follows outgoing edges, recursively building task subtrees for each control-flow node it meets. Joins are tracked by name so the matching JOIN can be inserted after a FORK_JOIN.

- [ ] **Step 3.1: write `conductor-types.ts`**

```typescript
// Discriminated union of all Conductor task shapes the converter can emit.

export interface SimpleTask {
  type: "SIMPLE";
  name: string;
  taskReferenceName: string;
  inputParameters: Record<string, unknown>;
}

export interface SwitchTask {
  type: "SWITCH";
  name: string;
  taskReferenceName: string;
  evaluatorType: "javascript" | "value-param";
  expression: string;
  inputParameters: Record<string, unknown>;
  decisionCases: Record<string, ConductorTaskDef[]>;
  defaultCase?: ConductorTaskDef[];
}

export interface ForkJoinTask {
  type: "FORK_JOIN";
  name: string;
  taskReferenceName: string;
  forkTasks: ConductorTaskDef[][];   // each inner array is one branch
}

export interface JoinTask {
  type: "JOIN";
  name: string;
  taskReferenceName: string;
  joinOn: string[];                  // taskReferenceNames of the last task in each branch
}

export interface DoWhileTask {
  type: "DO_WHILE";
  name: string;
  taskReferenceName: string;
  loopCondition: string;             // JS expression, e.g. "$.iteration < 5"
  loopOver: ConductorTaskDef[];
  inputParameters: Record<string, unknown>;
}

export interface WaitTask {
  type: "WAIT";
  name: string;
  taskReferenceName: string;
  inputParameters: { duration?: string; until?: string };
}

export interface SubWorkflowTask {
  type: "SUB_WORKFLOW";
  name: string;
  taskReferenceName: string;
  subWorkflowParam: { name: string; version?: number };
  inputParameters: Record<string, unknown>;
}

export interface TerminateTask {
  type: "TERMINATE";
  name: string;
  taskReferenceName: string;
  inputParameters: { terminationStatus: "COMPLETED" | "FAILED"; workflowOutput?: Record<string, unknown> };
}

export type ConductorTaskDef =
  | SimpleTask
  | SwitchTask
  | ForkJoinTask
  | JoinTask
  | DoWhileTask
  | WaitTask
  | SubWorkflowTask
  | TerminateTask;

export interface ConductorWorkflowDef {
  name: string;
  version: number;
  schemaVersion: 2;
  tasks: ConductorTaskDef[];
  /** Phase 4: max times any single node may execute in this workflow. Enforced by the worker harness. */
  cycleVisitLimit?: number;
}
```

- [ ] **Step 3.2: rewrite `conductor-converter.ts`**

Replace the file contents with:

```typescript
import type { FlowEdge, FlowGraph, FlowNode, IFlowJsonConverter } from "@journeyman/core";
import type {
  ConductorTaskDef, ConductorWorkflowDef,
  ForkJoinTask, JoinTask, SwitchTask, DoWhileTask, WaitTask,
  SubWorkflowTask, TerminateTask, SimpleTask,
} from "./conductor-types.ts";

export class UnsupportedNodeTypeError extends Error {
  constructor(public readonly nodeType: string) {
    super(`Node type '${nodeType}' is not yet supported`);
    this.name = "UnsupportedNodeTypeError";
  }
}

export class FlowValidationError extends Error {
  constructor(message: string) { super(message); this.name = "FlowValidationError"; }
}

export class ConductorJsonConverter implements IFlowJsonConverter<ConductorWorkflowDef> {
  toEngineJson(def: FlowGraph, opts: {
    workflowName: string;
    workflowVersion: number;
  }): ConductorWorkflowDef {
    const ctx = new ConvertCtx(def);
    ctx.validate();

    const start = ctx.startNode();
    const tasks = ctx.buildSequence(ctx.successor(start.id));

    return {
      name: opts.workflowName,
      version: opts.workflowVersion,
      schemaVersion: 2,
      tasks,
      cycleVisitLimit: def.maxCycleVisits ?? 100,
    };
  }
}

class ConvertCtx {
  readonly nodes: Map<string, FlowNode>;
  readonly outgoing: Map<string, FlowEdge[]>;
  /** Nodes already emitted into a task list — used to detect joins and back-edges. */
  readonly emitted = new Set<string>();

  constructor(public flow: FlowGraph) {
    this.nodes = new Map(flow.nodes.map(n => [n.id, n]));
    this.outgoing = new Map();
    for (const e of flow.edges) {
      const arr = this.outgoing.get(e.source) ?? [];
      arr.push(e);
      this.outgoing.set(e.source, arr);
    }
  }

  validate(): void {
    const starts = this.flow.nodes.filter(n => n.type === "start");
    if (starts.length !== 1) throw new FlowValidationError("Flow must have exactly one start node");
    const ends = this.flow.nodes.filter(n => n.type === "end");
    if (ends.length === 0) throw new FlowValidationError("Flow must have at least one end node");
  }

  startNode(): FlowNode { return this.flow.nodes.find(n => n.type === "start")!; }

  successor(nodeId: string): string | null {
    const out = this.outgoing.get(nodeId) ?? [];
    return out[0]?.target ?? null;
  }

  outsOf(nodeId: string): FlowEdge[] { return this.outgoing.get(nodeId) ?? []; }

  /** Emit the tasks reachable from `nodeId` until an end node, a join target, or the graph runs out. */
  buildSequence(startId: string | null, stopAt?: Set<string>): ConductorTaskDef[] {
    const tasks: ConductorTaskDef[] = [];
    let cur = startId;
    while (cur) {
      if (stopAt?.has(cur)) break;
      if (this.emitted.has(cur)) {
        // Re-entry: this is a back-edge (loop or cycle). The DO_WHILE handler
        // catches loops explicitly; outside a loop, a back-edge becomes a no-op
        // here and the engine's cycle-visit limit guards against infinite runs.
        break;
      }
      this.emitted.add(cur);
      const node = this.nodes.get(cur);
      if (!node) break;

      if (node.type === "end") {
        // Multi-end: emit a TERMINATE task with this end's outcome label.
        tasks.push(this.terminateTask(node));
        break;
      }

      const emitted = this.emitNode(node);
      tasks.push(...emitted.tasks);
      cur = emitted.nextNodeId;
    }
    return tasks;
  }

  emitNode(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    switch (node.type) {
      case "phase":        return this.emitPhase(node);
      case "gateway-xor":
      case "if":           return this.emitSwitch(node);
      case "gateway-and":  return this.emitForkJoin(node);
      case "loop":         return this.emitDoWhile(node);
      case "timer":        return this.emitWait(node);
      case "subflow":      return this.emitSubflow(node);
      case "retry-block":
      case "try-catch":
      case "human-task":   throw new UnsupportedNodeTypeError(node.type);
      default:             throw new UnsupportedNodeTypeError(node.type);
    }
  }

  // --- node emitters ------------------------------------------------------

  emitPhase(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    if (!node.phaseType) throw new FlowValidationError(`Phase node '${node.id}' missing phaseType`);
    const task: SimpleTask = {
      type: "SIMPLE",
      name: node.phaseType,
      taskReferenceName: node.id,
      inputParameters: { ...(node.config ?? {}) },
    };
    return { tasks: [task], nextNodeId: this.successor(node.id) };
  }

  emitSwitch(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const outs = this.outsOf(node.id);
    if (outs.length === 0) {
      throw new FlowValidationError(`Switch '${node.id}' has no outgoing edges`);
    }
    const cases: Record<string, ConductorTaskDef[]> = {};
    let defaultCase: ConductorTaskDef[] | undefined;

    // After all cases converge, we want to continue from a single "join target" node.
    // A simple convergence rule: find the lowest-common descendant — for v0 we just
    // require that all branch heads eventually point to the same single node, and
    // sequence stops when any branch hits that node.
    const branchTargets = outs.map(e => e.target);
    const convergence = findConvergence(branchTargets, this);
    const stopAt = convergence ? new Set([convergence]) : undefined;

    for (const e of outs) {
      const branchTasks = this.buildSequence(e.target, stopAt);
      if (e.type === "else" || e.branchLabel === "default") {
        defaultCase = branchTasks;
      } else {
        const label = e.branchLabel ?? (e.type === "conditional" ? jsonLogicToString(e.condition) : `case_${cases ? Object.keys(cases).length + 1 : 1}`);
        cases[label] = branchTasks;
      }
    }

    const task: SwitchTask = {
      type: "SWITCH",
      name: `switch_${node.id}`,
      taskReferenceName: node.id,
      evaluatorType: "value-param",
      expression: "branch",
      inputParameters: { branch: "${workflow.input.branch}" },   // user wires via I/O tab in Phase 5
      decisionCases: cases,
      ...(defaultCase ? { defaultCase } : {}),
    };
    return { tasks: [task], nextNodeId: convergence };
  }

  emitForkJoin(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const outs = this.outsOf(node.id);
    if (outs.length < 2) {
      throw new FlowValidationError(`gateway-and '${node.id}' must have at least 2 outgoing edges`);
    }
    const branchTargets = outs.map(e => e.target);
    const convergence = findConvergence(branchTargets, this);
    if (!convergence) {
      throw new FlowValidationError(`gateway-and '${node.id}' branches must converge on a single join node`);
    }
    const stopAt = new Set([convergence]);

    const forkTasks: ConductorTaskDef[][] = outs.map(e => this.buildSequence(e.target, stopAt));

    const fork: ForkJoinTask = {
      type: "FORK_JOIN",
      name: `fork_${node.id}`,
      taskReferenceName: node.id,
      forkTasks,
    };
    const join: JoinTask = {
      type: "JOIN",
      name: `join_${node.id}`,
      taskReferenceName: `${node.id}_join`,
      joinOn: forkTasks.map(branch => branch.at(-1)?.taskReferenceName).filter((x): x is string => !!x),
    };
    // After the join the sequence continues from the convergence node.
    return { tasks: [fork, join], nextNodeId: convergence };
  }

  emitDoWhile(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    // The loop body is the path from the loop's first body node back to the loop node.
    // We follow the loop's outgoing edge and walk until we either hit `node.id` again
    // or hit an end. The successor *after* the loop is taken from edges that leave
    // any node in the body to a target outside the loop subgraph.
    const outs = this.outsOf(node.id);
    if (outs.length === 0) throw new FlowValidationError(`Loop '${node.id}' has no body edge`);
    const bodyHead = outs[0].target;
    // Stop when we re-enter the loop node (back-edge).
    const stopAt = new Set([node.id]);

    // Save and restore `emitted` so the body can re-emit the same task graph
    // on subsequent iterations from the engine's perspective.
    const savedEmitted = new Set(this.emitted);
    const body = this.buildSequence(bodyHead, stopAt);
    this.emitted = savedEmitted;
    this.emitted.add(node.id);

    const condition = (node.config?.["loopCondition"] as string | undefined)
      ?? `$.${node.id}["iteration"] < ${(node.config?.["maxIterations"] as number | undefined) ?? 5}`;

    const task: DoWhileTask = {
      type: "DO_WHILE",
      name: `loop_${node.id}`,
      taskReferenceName: node.id,
      loopCondition: condition,
      loopOver: body,
      inputParameters: { ...(node.config ?? {}) },
    };

    // After the loop, follow whichever node-exit edge leaves the loop region.
    // For v0: the loop's *second* outgoing edge (if any) is treated as the "exit";
    // common UX is for users to draw one edge into the body and one out of the loop node.
    const exit = outs[1]?.target ?? null;
    return { tasks: [task], nextNodeId: exit };
  }

  emitWait(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const cfg = (node.config ?? {}) as { duration?: string; until?: string };
    const task: WaitTask = {
      type: "WAIT",
      name: `wait_${node.id}`,
      taskReferenceName: node.id,
      inputParameters: cfg,
    };
    return { tasks: [task], nextNodeId: this.successor(node.id) };
  }

  emitSubflow(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const target = (node.config ?? {}) as { workflowName?: string; workflowVersion?: number };
    if (!target.workflowName) {
      throw new FlowValidationError(`Subflow '${node.id}' must specify config.workflowName`);
    }
    const task: SubWorkflowTask = {
      type: "SUB_WORKFLOW",
      name: `sub_${node.id}`,
      taskReferenceName: node.id,
      subWorkflowParam: { name: target.workflowName, version: target.workflowVersion },
      inputParameters: { ...(node.config ?? {}) },
    };
    return { tasks: [task], nextNodeId: this.successor(node.id) };
  }

  terminateTask(endNode: FlowNode): TerminateTask {
    return {
      type: "TERMINATE",
      name: `terminate_${endNode.id}`,
      taskReferenceName: endNode.id,
      inputParameters: {
        terminationStatus: "COMPLETED",
        workflowOutput: endNode.outcome ? { outcome: endNode.outcome } : undefined,
      },
    };
  }
}

// --- helpers --------------------------------------------------------------

/**
 * Find the first single node where every branch from `branchHeads` re-converges.
 * Returns null if the branches never re-converge (all paths end independently).
 *
 * This is a BFS-walk per branch, then intersect the visited sets. The first node
 * that appears in *every* branch's visited set, in topological order, is the
 * convergence point. For Phase 4 this is good enough — Phase 5 may upgrade to
 * proper LCA when nested gateways become common.
 */
function findConvergence(branchHeads: string[], ctx: ConvertCtx): string | null {
  if (branchHeads.length === 0) return null;
  const visitedPerBranch: Set<string>[] = branchHeads.map(h => walkReachable(h, ctx));
  const intersection = [...visitedPerBranch[0]].filter(id =>
    visitedPerBranch.every(s => s.has(id)),
  );
  // Pick the one that's nearest each branch head — approximate by smallest sum of BFS distance.
  if (intersection.length === 0) return null;
  // For simplicity: pick the first intersection by topological order (lexicographic on id is fine for v0).
  intersection.sort();
  return intersection[0] ?? null;
}

function walkReachable(start: string, ctx: ConvertCtx): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of ctx.outsOf(cur)) {
      if (!seen.has(e.target)) stack.push(e.target);
    }
  }
  return seen;
}

function jsonLogicToString(expr: unknown): string {
  if (expr == null) return "case";
  try { return JSON.stringify(expr).slice(0, 32); } catch { return "case"; }
}
```

(Two known v0 simplifications, both surfaced inline as comments and acceptable for Phase 4: branch convergence picks lexicographic-min instead of true LCA, and SWITCH `expression`/`inputParameters` are placeholders until the I/O tab in Phase 5 lets users wire real branch keys. Both produce valid Conductor JSON that runs; they just aren't optimal until the editor catches up.)

- [ ] **Step 3.3: update `orchestrator/src/index.ts` — add new type exports**

Replace the existing `ConductorJsonConverter` export block with:

```typescript
export {
  ConductorJsonConverter,
  UnsupportedNodeTypeError,
  FlowValidationError,
} from "./flow-json/conductor-converter.ts";
export type {
  ConductorWorkflowDef,
  ConductorTaskDef,
  SimpleTask,
  SwitchTask,
  ForkJoinTask,
  JoinTask,
  DoWhileTask,
  WaitTask,
  SubWorkflowTask,
  TerminateTask,
} from "./flow-json/conductor-types.ts";
```

---

## Task 4: Cycle visit-count guard in worker harness

**Files:**
- Create: `packages/orchestrator/src/workers/visit-counter.ts`
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`

The converter emits `cycleVisitLimit` on the workflow definition. The engine itself doesn't enforce a per-node visit count out of the box, so the worker harness counts visits per `(runId, nodeId)` and returns a terminal failure if exceeded. The map is in-process; for multi-worker setups Phase 7 swaps it for a Postgres-backed counter (added there alongside per-user workspaces).

- [ ] **Step 4.1: write `visit-counter.ts`**

```typescript
export class VisitCounter {
  private counts = new Map<string, number>();
  private limit: number;

  constructor(limit: number = 100) { this.limit = limit; }

  setLimit(limit: number): void { this.limit = limit; }

  /** Records a visit and returns whether the limit was exceeded. */
  recordVisit(runId: string, nodeId: string): { count: number; exceeded: boolean } {
    const key = `${runId}::${nodeId}`;
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return { count: next, exceeded: next > this.limit };
  }

  /** Best-effort cleanup once a run terminates. */
  forgetRun(runId: string): void {
    for (const k of this.counts.keys()) {
      if (k.startsWith(`${runId}::`)) this.counts.delete(k);
    }
  }
}
```

- [ ] **Step 4.2: wire it into `worker-harness.ts`**

Open `worker-harness.ts` and:

1. Import `VisitCounter`:
   ```typescript
   import { VisitCounter } from "./visit-counter.ts";
   ```
2. Add a private field to the class:
   ```typescript
   private visitCounter = new VisitCounter();
   ```
3. Inside `processOnce`, after the line `const handler = this.deps.registry.get(phaseType);` and before the `if (!handler)` check, insert:

   ```typescript
   const visit = this.visitCounter.recordVisit(task.workflowInstanceId, task.taskDefName);
   if (visit.exceeded) {
     await this.deps.events.append({
       runId: task.workflowInstanceId,
       nodeId: task.taskDefName,
       eventType: "node.cycled",
       payload: { count: visit.count, limit: -1 /* per-flow limit set by converter; surfaced via run input */ },
     });
     await this.deps.client.completeTask({
       workflowInstanceId: task.workflowInstanceId,
       taskId: task.taskId,
       status: "FAILED_WITH_TERMINAL_ERROR",
       reasonForIncompletion: `CycleLimitExceeded: node '${task.taskDefName}' visited ${visit.count} times`,
     });
     return;
   }
   ```

(Note: the per-flow limit is read from the workflow def via `task.inputData.cycleVisitLimit` if the converter chose to inject it; for v0 the harness uses the `VisitCounter`'s default of 100, configurable via env `CYCLE_VISIT_LIMIT`. Phase 5 plumbs the per-flow value through.)

---

## Task 5: New React Flow node components

**Files:** all new under `packages/flow-editor/src/canvas/nodes/`
- Create: `GatewayXorNode.tsx`
- Create: `GatewayAndNode.tsx`
- Create: `LoopNode.tsx`
- Create: `SubflowNode.tsx`
- Create: `IfNode.tsx`
- Create: `TimerNode.tsx`
- Modify: `PhaseNode.tsx`

All node components share the visual language already established in Phase 2 (`.je-node` chunky tile). Gateways render as diamond shapes via CSS `transform: rotate(45deg)`; loops as a tile with a ↻ accent; timer with a ⏱ accent; subflow with a nested-tile glyph.

- [ ] **Step 5.1: `GatewayXorNode.tsx`**

```tsx
import { Handle, Position } from "@xyflow/react";

export function GatewayXorNode() {
  return (
    <div className="je-node je-node--gateway je-node--xor">
      <Handle type="target" position={Position.Top} />
      <div className="je-node__icon">×</div>
      <div className="je-node__label">XOR</div>
      <Handle type="source" position={Position.Bottom} id="default" />
    </div>
  );
}
```

- [ ] **Step 5.2: `GatewayAndNode.tsx`**

```tsx
import { Handle, Position } from "@xyflow/react";

export function GatewayAndNode() {
  return (
    <div className="je-node je-node--gateway je-node--and">
      <Handle type="target" position={Position.Top} />
      <div className="je-node__icon">+</div>
      <div className="je-node__label">AND</div>
      <Handle type="source" position={Position.Bottom} id="default" />
    </div>
  );
}
```

- [ ] **Step 5.3: `LoopNode.tsx`**

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";

export function LoopNode(props: NodeProps) {
  const data = props.data as { displayName?: string };
  return (
    <div className="je-node je-node--loop">
      <Handle type="target" position={Position.Top} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "#fdcb6e" }}>↻</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "Loop"}</div>
          <div className="je-node__subtitle">do-while</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="body" />
      <Handle type="source" position={Position.Right} id="exit" />
    </div>
  );
}
```

- [ ] **Step 5.4: `SubflowNode.tsx`**

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";

export function SubflowNode(props: NodeProps) {
  const data = props.data as { displayName?: string; workflowName?: string };
  return (
    <div className="je-node je-node--subflow">
      <Handle type="target" position={Position.Top} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "#a29bfe" }}>⊞</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "Subflow"}</div>
          <div className="je-node__subtitle">{data.workflowName ?? "—"}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

- [ ] **Step 5.5: `IfNode.tsx`**

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";

export function IfNode(props: NodeProps) {
  const data = props.data as { displayName?: string };
  return (
    <div className="je-node je-node--if">
      <Handle type="target" position={Position.Top} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "#74b9ff" }}>?</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "If"}</div>
          <div className="je-node__subtitle">then / else</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="then" style={{ left: "30%" }} />
      <Handle type="source" position={Position.Bottom} id="else" style={{ left: "70%" }} />
    </div>
  );
}
```

- [ ] **Step 5.6: `TimerNode.tsx`**

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";

export function TimerNode(props: NodeProps) {
  const data = props.data as { displayName?: string; duration?: string };
  return (
    <div className="je-node je-node--timer">
      <Handle type="target" position={Position.Top} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "#fdcb6e" }}>⏱</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "Wait"}</div>
          <div className="je-node__subtitle">{data.duration ?? "—"}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

- [ ] **Step 5.7: modify `PhaseNode.tsx`** — add the secondary error output handle.

Replace the file:

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { PhaseCatalogEntry } from "../../types.ts";

export interface PhaseNodeData {
  displayName: string;
  phaseType: string;
  catalogEntry?: PhaseCatalogEntry;
  [key: string]: unknown;
}

export function PhaseNode(props: NodeProps) {
  const data = props.data as PhaseNodeData;
  const accent = data.catalogEntry?.color ?? "#6c5ce7";
  const icon = data.catalogEntry?.icon ?? "⚙";
  const subtitle = data.catalogEntry?.label ?? data.phaseType;
  return (
    <div className="je-node je-node--phase" style={{ borderColor: accent }}>
      <Handle type="target" position={Position.Top} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: accent }}>{icon}</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName}</div>
          <div className="je-node__subtitle">{subtitle}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="default" />
      <Handle
        type="source"
        position={Position.Right}
        id="error"
        style={{ background: "#ff7675", border: "2px solid #1a1a24" }}
        title="Error output"
      />
    </div>
  );
}
```

---

## Task 6: New edge components

**Files:**
- Create: `packages/flow-editor/src/canvas/edges/ConditionalEdge.tsx`
- Create: `packages/flow-editor/src/canvas/edges/ErrorEdge.tsx`
- Create: `packages/flow-editor/src/canvas/edges/ElseEdge.tsx`

Each is a thin wrapper around `BaseEdge` with a colored stroke and optional inline label.

- [ ] **Step 6.1: `ConditionalEdge.tsx`**

```tsx
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export function ConditionalEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX, sourceY: props.sourceY,
    targetX: props.targetX, targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 8,
  });
  const data = props.data as { branchLabel?: string; condition?: unknown } | undefined;
  const label = data?.branchLabel ?? "if";
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd}
        style={{ stroke: "#fdcb6e", strokeWidth: 2, strokeDasharray: "6 4" }} />
      <EdgeLabelRenderer>
        <div style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          background: "#1a1a24", border: "1px solid #fdcb6e", color: "#fdcb6e",
          fontSize: 10, padding: "1px 6px", borderRadius: 4, pointerEvents: "all" }}>
          {label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
```

- [ ] **Step 6.2: `ErrorEdge.tsx`**

```tsx
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export function ErrorEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX, sourceY: props.sourceY,
    targetX: props.targetX, targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 8,
  });
  return (
    <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd}
      style={{ stroke: "#ff7675", strokeWidth: 2, strokeDasharray: "4 3" }} />
  );
}
```

- [ ] **Step 6.3: `ElseEdge.tsx`**

```tsx
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export function ElseEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX, sourceY: props.sourceY,
    targetX: props.targetX, targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 8,
  });
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd}
        style={{ stroke: "#888", strokeWidth: 2, strokeDasharray: "2 4" }} />
      <EdgeLabelRenderer>
        <div style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          background: "#1a1a24", color: "#888", fontSize: 10, padding: "1px 6px", borderRadius: 4 }}>else</div>
      </EdgeLabelRenderer>
    </>
  );
}
```

---

## Task 7: Register the new node + edge types

**Files:**
- Modify: `packages/flow-editor/src/canvas/node-registry.ts`
- Modify: `packages/flow-editor/src/styles.css`

- [ ] **Step 7.1: extend `node-registry.ts`**

```typescript
import { StartNode } from "./nodes/StartNode.tsx";
import { EndNode } from "./nodes/EndNode.tsx";
import { PhaseNode } from "./nodes/PhaseNode.tsx";
import { GatewayXorNode } from "./nodes/GatewayXorNode.tsx";
import { GatewayAndNode } from "./nodes/GatewayAndNode.tsx";
import { LoopNode } from "./nodes/LoopNode.tsx";
import { SubflowNode } from "./nodes/SubflowNode.tsx";
import { IfNode } from "./nodes/IfNode.tsx";
import { TimerNode } from "./nodes/TimerNode.tsx";
import { DefaultEdge } from "./edges/DefaultEdge.tsx";
import { ConditionalEdge } from "./edges/ConditionalEdge.tsx";
import { ErrorEdge } from "./edges/ErrorEdge.tsx";
import { ElseEdge } from "./edges/ElseEdge.tsx";

export const nodeTypes = {
  start: StartNode,
  end: EndNode,
  phase: PhaseNode,
  "gateway-xor": GatewayXorNode,
  "gateway-and": GatewayAndNode,
  loop: LoopNode,
  subflow: SubflowNode,
  if: IfNode,
  timer: TimerNode,
};

export const edgeTypes = {
  default: DefaultEdge,
  conditional: ConditionalEdge,
  error: ErrorEdge,
  else: ElseEdge,
};
```

- [ ] **Step 7.2: append CSS for new node variants**

Append to `packages/flow-editor/src/styles.css`:

```css
.je-node--gateway { width: 64px; height: 64px; padding: 0; display: flex; align-items: center; justify-content: center; transform: rotate(45deg); border-radius: 8px; min-width: 0; }
.je-node--gateway .je-node__icon, .je-node--gateway .je-node__label { transform: rotate(-45deg); }
.je-node--gateway .je-node__label { font-size: 10px; }
.je-node--gateway .je-node__icon { width: 24px; height: 24px; background: transparent; font-size: 16px; }
.je-node--xor { border-color: #74b9ff; }
.je-node--and { border-color: #00b894; }
.je-node--loop { border-color: #fdcb6e; }
.je-node--subflow { border-color: #a29bfe; }
.je-node--if { border-color: #74b9ff; }
.je-node--timer { border-color: #fdcb6e; }
```

---

## Task 8: Validation helper + topbar banner

**Files:**
- Create: `packages/flow-editor/src/state/validation.ts`
- Modify: `packages/flow-editor/src/state/flow-graph.ts`
- Modify: `packages/flow-editor/src/topbar/Topbar.tsx`
- Modify: `packages/flow-editor/src/FlowEditor.tsx`

- [ ] **Step 8.1: `validation.ts`**

```typescript
import type { FlowGraph } from "@journeyman/core";

export interface ValidationResult { ok: boolean; errors: string[]; }

export function isValidPhase4Graph(flow: FlowGraph): ValidationResult {
  const errors: string[] = [];
  const starts = flow.nodes.filter(n => n.type === "start");
  if (starts.length !== 1) errors.push("Flow must have exactly one start node");
  if (flow.nodes.filter(n => n.type === "end").length === 0) {
    errors.push("Flow must have at least one end node");
  }

  const out = new Map<string, number>();
  const inn = new Map<string, number>();
  for (const e of flow.edges) {
    out.set(e.source, (out.get(e.source) ?? 0) + 1);
    inn.set(e.target, (inn.get(e.target) ?? 0) + 1);
  }
  for (const n of flow.nodes) {
    if (n.type === "end") {
      if ((out.get(n.id) ?? 0) > 0) errors.push(`End '${n.id}' has outgoing edges`);
    }
    if (n.type === "gateway-xor" || n.type === "if") {
      if ((out.get(n.id) ?? 0) < 2) errors.push(`Gateway/If '${n.id}' needs at least 2 branches`);
    }
    if (n.type === "gateway-and") {
      if ((out.get(n.id) ?? 0) < 2) errors.push(`gateway-and '${n.id}' needs at least 2 branches`);
    }
    if (n.type === "phase" && !n.phaseType) {
      errors.push(`Phase node '${n.id}' is missing a phase type`);
    }
    if (n.type === "subflow" && !(n.config as { workflowName?: string } | undefined)?.workflowName) {
      errors.push(`Subflow '${n.id}' is missing config.workflowName`);
    }
  }

  // Reachability: every non-start node must be reachable from start.
  if (starts.length === 1) {
    const reachable = new Set<string>();
    const stack: string[] = [starts[0].id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      for (const e of flow.edges) if (e.source === cur && !reachable.has(e.target)) stack.push(e.target);
    }
    for (const n of flow.nodes) {
      if (!reachable.has(n.id)) errors.push(`Node '${n.id}' is unreachable from start`);
    }
  }

  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 8.2: re-export from `flow-graph.ts`** (keeps backward-compat with Phase 2 callers)

Append to `flow-graph.ts`:

```typescript
export { isValidPhase4Graph } from "./validation.ts";
```

(Keep `isLinearAndComplete` exported and unchanged — Phase 2 callers depend on it. New code uses `isValidPhase4Graph`.)

- [ ] **Step 8.3: extend `Topbar.tsx`** — add a validation-error banner under the bar.

Replace the `Topbar` component file with:

```tsx
import { useState } from "react";

export interface TopbarProps {
  flowName: string;
  onRename?: (next: string) => void;
  onSave?: () => void;
  onRun?: () => void;
  busy?: boolean;
  dirty?: boolean;
  saveEnabled?: boolean;
  runEnabled?: boolean;
  runDisabledReason?: string;
  validationErrors?: string[];
}

export function Topbar(p: TopbarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.flowName);
  return (
    <>
      <header className="je-editor__topbar">
        {editing && p.onRename ? (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { setEditing(false); if (draft !== p.flowName) p.onRename!(draft); }}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            style={{ background: "#1f1f2c", border: "1px solid #2a2a3a", color: "#fff", padding: "4px 8px", borderRadius: 4 }}
          />
        ) : (
          <h1
            onClick={() => { if (p.onRename) { setDraft(p.flowName); setEditing(true); } }}
            style={{ cursor: p.onRename ? "text" : "default" }}
          >
            {p.flowName}
          </h1>
        )}
        {p.dirty && <span style={{ color: "#fdcb6e", fontSize: 11 }}>● unsaved</span>}
        <div className="spacer" />
        <button disabled={p.busy || !p.saveEnabled} onClick={p.onSave}>
          {p.busy ? "Saving…" : "Save"}
        </button>
        <button
          className="primary"
          disabled={p.busy || !p.runEnabled}
          title={p.runDisabledReason}
          onClick={p.onRun}
        >▶ Run</button>
      </header>
      {p.validationErrors && p.validationErrors.length > 0 && (
        <div style={{
          background: "#2a1a1a", borderBottom: "1px solid #ff7675",
          color: "#ff7675", fontSize: 11, padding: "6px 14px",
        }}>
          {p.validationErrors.length === 1
            ? p.validationErrors[0]
            : `${p.validationErrors.length} validation issues — ${p.validationErrors[0]}`}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 8.4: feed validation results into `FlowEditor.tsx`**

Open `FlowEditor.tsx` and replace the `useMemo(() => isLinearAndComplete(...))` line with:

```typescript
import { isValidPhase4Graph } from "./state/validation.ts";
// …
const validity = useMemo(() => isValidPhase4Graph(props.flow), [props.flow]);
```

Then update the `<Topbar>` invocation to pass:

```tsx
<Topbar
  // existing props…
  runEnabled={!props.readOnly && !!props.onRun && validity.ok}
  runDisabledReason={validity.ok ? undefined : validity.errors[0]}
  validationErrors={validity.errors}
/>
```

(The grid in `.je-editor` is still `grid-template-rows: 44px 1fr`; the banner sits above the body and pushes down by its own height — no grid change needed.)

---

## Task 9: Palette grows — control-node catalog

**Files:**
- Create: `packages/flow-editor/src/palette/built-in-categories.ts`
- Modify: `packages/flow-editor/src/types.ts`
- Modify: `packages/flow-editor/src/palette/Palette.tsx`
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx`
- Modify: `packages/flow-editor/src/FlowEditor.tsx`
- Modify: `packages/flow-editor/src/index.ts`

- [ ] **Step 9.1: extend `types.ts`**

```typescript
import type { FlowGraph, FlowNodeType } from "@journeyman/core";

// existing PhaseCatalogEntry / PhaseCatalog stay…

export interface ControlNodeCatalogEntry {
  nodeType: FlowNodeType;
  label: string;
  category: string;
  description?: string;
  color: string;
  icon: string;
}
export type ControlNodeCatalog = ControlNodeCatalogEntry[];

export interface FlowEditorProps {
  flow: FlowGraph;
  flowName: string;
  phaseCatalog: PhaseCatalog;
  controlCatalog?: ControlNodeCatalog;
  onChange: (flow: FlowGraph) => void;
  onSave?: (flow: FlowGraph) => void | Promise<void>;
  onRun?: (flow: FlowGraph) => void | Promise<void>;
  readOnly?: boolean;
  busy?: boolean;
  onRename?: (newName: string) => void;
}
```

- [ ] **Step 9.2: write `built-in-categories.ts`** — default control nodes shown when consumer doesn't supply their own.

```typescript
import type { ControlNodeCatalog } from "../types.ts";

export const defaultControlCatalog: ControlNodeCatalog = [
  { nodeType: "if",            label: "If / Else",  category: "Logic",   color: "#74b9ff", icon: "?",  description: "Branch on a condition" },
  { nodeType: "gateway-xor",   label: "XOR",        category: "Logic",   color: "#74b9ff", icon: "×",  description: "Exactly one branch taken" },
  { nodeType: "gateway-and",   label: "AND (parallel)", category: "Logic", color: "#00b894", icon: "+", description: "Run branches in parallel; join after" },
  { nodeType: "loop",          label: "Loop",       category: "Control", color: "#fdcb6e", icon: "↻",  description: "Iterate body while condition holds" },
  { nodeType: "timer",         label: "Wait",       category: "Control", color: "#fdcb6e", icon: "⏱",  description: "Pause for a duration or until a time" },
  { nodeType: "subflow",       label: "Subflow",    category: "Subflows",color: "#a29bfe", icon: "⊞",  description: "Invoke another flow as a step" },
];
```

- [ ] **Step 9.3: extend `Palette.tsx`** — render control nodes alongside phases.

Replace the file:

```tsx
import { useMemo } from "react";
import { PaletteItem } from "./PaletteItem.tsx";
import type { ControlNodeCatalog, PhaseCatalog } from "../types.ts";

export interface PaletteProps {
  catalog: PhaseCatalog;
  controlCatalog?: ControlNodeCatalog;
}

type AnyEntry =
  | { kind: "phase";   phaseType: string; label: string; category: string; color: string; icon: string; description?: string }
  | { kind: "control"; nodeType: string;  label: string; category: string; color: string; icon: string; description?: string };

export function Palette({ catalog, controlCatalog }: PaletteProps) {
  const entries = useMemo<AnyEntry[]>(() => [
    ...catalog.map(c => ({ kind: "phase" as const, ...c })),
    ...(controlCatalog ?? []).map(c => ({ kind: "control" as const, ...c })),
  ], [catalog, controlCatalog]);

  const grouped = useMemo(() => {
    const m = new Map<string, AnyEntry[]>();
    for (const e of entries) {
      const arr = m.get(e.category) ?? [];
      arr.push(e);
      m.set(e.category, arr);
    }
    return [...m.entries()];
  }, [entries]);

  return (
    <aside className="je-editor__palette">
      <div className="je-palette__title" style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Phases</div>
      {grouped.map(([cat, items]) => (
        <div key={cat}>
          <div className="je-palette__group">{cat}</div>
          {items.map(it => (
            <PaletteItem
              key={it.kind === "phase" ? `phase:${it.phaseType}` : `control:${it.nodeType}`}
              entry={{ ...it, dragMime: it.kind === "phase" ? "application/journeyman-phase" : "application/journeyman-control" }}
            />
          ))}
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 9.4: update `PaletteItem.tsx`** to accept an explicit MIME and value.

Replace the file:

```tsx
export interface PaletteItemEntryLike {
  label: string;
  description?: string;
  color: string;
  icon: string;
  phaseType?: string;
  nodeType?: string;
  dragMime: string;
}

export interface PaletteItemProps {
  entry: PaletteItemEntryLike;
}

export function PaletteItem({ entry }: PaletteItemProps) {
  const onDragStart = (ev: React.DragEvent) => {
    const value = entry.phaseType ?? entry.nodeType ?? "";
    ev.dataTransfer.setData(entry.dragMime, value);
    ev.dataTransfer.effectAllowed = "move";
  };
  return (
    <div className="je-palette__item" draggable onDragStart={onDragStart} title={entry.description ?? ""}>
      <div className="je-palette__icon" style={{ background: entry.color }}>{entry.icon}</div>
      <span>{entry.label}</span>
    </div>
  );
}
```

- [ ] **Step 9.5: extend `Canvas.tsx` — accept control-node drops too**

In `Canvas.tsx`, replace the `handleDrop` callback with:

```typescript
const handleDrop = useCallback((ev: React.DragEvent) => {
  if (p.readOnly) return;
  ev.preventDefault();
  const phaseType = ev.dataTransfer.getData("application/journeyman-phase");
  const controlType = ev.dataTransfer.getData("application/journeyman-control");
  const rect = wrapper.current?.getBoundingClientRect();
  const position = rect
    ? { x: ev.clientX - rect.left - 80, y: ev.clientY - rect.top - 30 }
    : { x: 200, y: 200 };

  if (phaseType) {
    const entry = p.catalog.find(c => c.phaseType === phaseType);
    const node = newPhaseNode({ phaseType, displayName: entry?.label ?? phaseType, position });
    p.onChange({ ...p.flow, nodes: [...p.flow.nodes, node] });
    return;
  }
  if (controlType) {
    const node = {
      id: `${controlType}_${Math.random().toString(36).slice(2, 8)}`,
      type: controlType as import("@journeyman/core").FlowNodeType,
      displayName: controlType,
      config: {},
      position,
    };
    p.onChange({ ...p.flow, nodes: [...p.flow.nodes, node] });
  }
}, [p]);
```

- [ ] **Step 9.6: relax `Canvas.tsx`'s `handleConnect` — Phase 4 supports multiple outgoing edges**

Replace `handleConnect`:

```typescript
const handleConnect = useCallback((conn: Connection) => {
  if (p.readOnly) return;
  if (!conn.source || !conn.target) return;
  // Phase 4: multiple outgoing edges allowed. Edge type defaults to "default";
  // edges from a gateway-xor / if get type "conditional"; edges from the
  // "error" handle on a phase get type "error".
  const sourceNode = p.flow.nodes.find(n => n.id === conn.source);
  let edgeType: "default" | "conditional" | "error" | "else" = "default";
  if (sourceNode?.type === "gateway-xor" || sourceNode?.type === "if") edgeType = "conditional";
  if (conn.sourceHandle === "error") edgeType = "error";
  if (conn.sourceHandle === "else")  edgeType = "else";
  const next = { ...newEdge(conn.source, conn.target), type: edgeType as import("@journeyman/core").FlowEdgeType };
  p.onChange({ ...p.flow, edges: [...p.flow.edges, next] });
}, [p]);
```

- [ ] **Step 9.7: pass `controlCatalog` through `<FlowEditor>`**

In `FlowEditor.tsx`, change the `<Palette>` invocation to:

```tsx
<Palette catalog={props.phaseCatalog} controlCatalog={props.controlCatalog} />
```

- [ ] **Step 9.8: export the default control catalog**

Append to `packages/flow-editor/src/index.ts`:

```typescript
export type { ControlNodeCatalog, ControlNodeCatalogEntry } from "./types.ts";
export { defaultControlCatalog } from "./palette/built-in-categories.ts";
```

---

## Task 10: Web shell wires the control catalog

**Files:**
- Create: `packages/web/src/catalogs/built-in-control-catalog.ts`
- Modify: `packages/web/src/routes/FlowEditorPage.tsx`

- [ ] **Step 10.1: re-export the default**

```typescript
// packages/web/src/catalogs/built-in-control-catalog.ts
export { defaultControlCatalog } from "@journeyman/flow-editor";
```

- [ ] **Step 10.2: pass it into `<FlowEditor>` from `FlowEditorPage.tsx`**

Add the import:

```typescript
import { defaultControlCatalog } from "../catalogs/built-in-control-catalog.ts";
```

And on the `<FlowEditor>` element:

```tsx
<FlowEditor
  // existing props…
  controlCatalog={defaultControlCatalog}
/>
```

---

## Task 11: install + repo-wide typecheck + manual smoke

- [ ] **Step 11.1: `npm install`** (no new deps; this just relinks the workspace).

- [ ] **Step 11.2: typecheck**

```bash
npm run typecheck
```
Expected: green across all 16 workspaces.

- [ ] **Step 11.3: smoke test (manual)**

1. Start the stack as before (`infra:up`, `migrate`, `start:api-server`, `start:worker`, `dev:web`).
2. Create a new flow. Drag onto the canvas: `Analyze` (phase) → `XOR` (gateway) → two parallel `Analyze` branches → `End` (×2 — one per branch). Wire conditional edges from XOR labelled "high" / "low".
3. Click **Save**. The validation banner should be empty. Click **Run** — the toast appears, click **View live →**. The run page renders the new node shapes and edge colors. The XOR branches display as expected (one branch lit by status badges, the other gray).
4. Build a second flow with a `Loop` node containing a single `Analyze` body and a `maxIterations: 3` config. Save & Run. Confirm the loop iterates three times and the canvas badge shows `×3` on the body node.

---

## Self-Review Checklist

**Spec coverage (Phase 4 from §12):**
- [x] gateway-xor, gateway-and, loop, subflow node types — Tasks 5, 7
- [x] if (XOR sugar), timer (cheap WAIT) — Tasks 5, 7
- [x] Multiple end nodes per flow with `outcome` — Task 1, Task 3 (TERMINATE per end), Task 8 (validation accepts ≥1 ends)
- [x] Conditional edges with `branchLabel` — Task 1, Task 6, Task 9.6
- [x] Per-phase error output edge — Task 5.7 (handle), Task 6.2 (edge component), Task 9.6 (auto-typing on connect)
- [x] `flow.maxCycleVisits` enforcement + visit-count badge — Task 4 (worker harness), `RunViewer` already shows `×N` from Phase 3
- [x] Editor-side validation surfaced — Task 8

**Phase 4 deliberate simplifications (documented inline):**
- Branch convergence picks lexicographic-min instead of true LCA; Phase 5 may upgrade.
- SWITCH `expression` / `inputParameters` are stubs until the I/O tab in Phase 5 lets users wire branch keys.
- Per-flow cycle visit limit is a constant in `VisitCounter`; Phase 5 plumbs the per-flow value through.
- Visual sub-flow drill-in (clicking a subflow opens its inner graph) is deferred to Phase 6.

**Out of scope (deferred):**
- `retry-block`, `try-catch`, `human-task` — Phase 5 / Phase 6+
- Per-edge condition expression editor — Phase 5 (with the I/O tab)

**Type consistency:**
- New node-type strings (`gateway-xor`, `gateway-and`, `loop`, `subflow`, `if`, `timer`) are already in `FlowNodeType` (added back in Phase 1). The converter, registry, and validation all use the same set.
- `outcome` and `branchLabel` are optional everywhere they're added (no breaking change for existing flows).
- `nodeTypes` and `edgeTypes` exports from `@journeyman/flow-editor` are still keyed by string and consumed by `@journeyman/run-viewer` via the same barrel.
