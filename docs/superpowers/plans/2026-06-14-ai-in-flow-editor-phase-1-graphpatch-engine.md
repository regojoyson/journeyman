# AI in the Flow Editor — Phase 1: GraphPatch Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, dependency-light **GraphPatch engine** — the data layer that represents AI-proposed edits as ordered ops and applies/validates them against a `WorkflowGraph` — with zero UI, routes, or DB, fully TDD'd.

**Architecture:** `GraphPatch`/`PatchOp` types live in `@journeyman/core` (the type source). The pure engine (`applyPatch`, `validatePatch`, `patchFromIntent`) lives in `@journeyman/builder` under a **pure subpath** (`@journeyman/builder/graph-patch`) that imports only `@journeyman/core` — mirroring the existing `@journeyman/mcp/sdk-adapter` pure-subpath pattern — so both the api-server (later: patch route) and the web/flow-editor AI module (later: accept/apply) can import it without pulling backend deps. New node/edge ids are minted in the **editor's own convention** (`step_<rand>`, `e_<src>_<tgt>_<rand>`) so AI-added nodes are indistinguishable from hand-added ones (F3).

**Tech Stack:** TypeScript, Vitest (`vitest run`), npm workspaces. `@journeyman/core` (types + registries, never imports other `@journeyman/*`), `@journeyman/builder` (Vitest, depends on core).

**Constraints (from the user, standing for this project):** **No `git commit` steps.** **The final step is `npm run check`** (typecheck all workspaces + import boundaries). Every code task ends by running its tests.

**Reference:** Spec `docs/superpowers/specs/2026-06-14-ai-in-flow-editor-design.md` — "The central concept: GraphPatch", findings F3/F6/F8/H1/H3/H8, and the phasing note (this is phase 1, minus `serializeGraph`/typed-catalog which become a separate grounding plan).

**Verified existing shapes (read before coding):**
- `WorkflowGraph` / `WorkflowNode` / `WorkflowEdge` — `packages/core/src/types/flow.types.ts`. Node: `{ id; type: WorkflowNodeType; displayName?; stepType?; config?; inputs?: Record<string,WorkflowInputValue>|null; executorConfig?; model?: string|null; sandboxId?; position: {x,y} }`. Edge: `{ id; source; target; type?: "default"|"conditional"|"else"|…; condition?: JsonLogicExpr; branchLabel? }`. `WORKFLOW_SCHEMA_VERSION = 2`.
- `AssemblerIntent` / `StepIntent` / `TriggerIntent` / `InputIntent` / `InputBindingIntent` — `packages/builder/src/assembler/intent.ts`. The existing `assemble(intent)` (`packages/builder/src/assembler/assemble.ts`) already turns an intent into a `{ workflow, stepBindings, gaps }` and imports only core + sibling pure modules.
- `CanonicalTool` — `packages/core/src/types/coding-tools.types.ts`. `CustomAiStepCreateInput` — `packages/core/src/types/custom-steps.types.ts`. `JsonLogicExpr`, `WorkflowInputValue`, `WorkflowNodeType` — `flow.types.ts`.
- Editor id convention — `packages/flow-editor/src/state/flow-graph.ts`: `step_<base36(6)>`, edges `e_<source>_<target>_<base36(4)>`. We replicate the *style* (not import flow-editor — that would break boundaries).
- Existing pure-subpath precedent — `@journeyman/mcp/sdk-adapter` (see `packages/mcp/package.json` `exports`).

---

## File Structure (Phase 1)

**Create:**
- `packages/core/src/types/graph-patch.types.ts` — `GraphPatch`, `PatchOp`, `PatchValidationResult`.
- `packages/builder/src/graph-patch/index.ts` — barrel for the pure subpath (re-exports the three modules below + `PATCHABLE_NODE_TYPES`).
- `packages/builder/src/graph-patch/node-types.ts` — `PATCHABLE_NODE_TYPES` (the F8 allow-list) + `isPatchable`.
- `packages/builder/src/graph-patch/apply.ts` — `applyPatch(graph, ops, opts?)`, `ApplyOptions`.
- `packages/builder/src/graph-patch/apply.test.ts`
- `packages/builder/src/graph-patch/validate.ts` — `validatePatch(graph, ops)`.
- `packages/builder/src/graph-patch/validate.test.ts`
- `packages/builder/src/graph-patch/from-intent.ts` — `patchFromIntent(intent)`.
- `packages/builder/src/graph-patch/from-intent.test.ts`

**Modify:**
- `packages/core/src/index.ts` — export the new types.
- `packages/builder/package.json` — add the `./graph-patch` subpath export (pure; core-only).

---

## Task 1: Core types — `GraphPatch` / `PatchOp`

**Files:**
- Create: `packages/core/src/types/graph-patch.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the types**

```typescript
// packages/core/src/types/graph-patch.types.ts
import type { WorkflowNodeType, WorkflowInputValue, JsonLogicExpr } from "./flow.types.ts";
import type { CanonicalTool } from "./coding-tools.types.ts";
import type { CustomAiStepCreateInput } from "./custom-steps.types.ts";

/** One edit against the current graph. `tempId` lets later ops in the same patch
 *  reference a node before it has a real id (resolved during apply). */
export type PatchOp =
  | {
      kind: "add-step";
      tempId: string;
      nodeType: WorkflowNodeType;          // "step" | "human-task" | "webhook-wait" | …
      label?: string;
      stepType?: string;                   // e.g. "open-pull-request", "custom-ai"
      config?: Record<string, unknown>;
      model?: string | null;
      sandboxId?: string;
      /** input wiring (H1) — slot → value; step-output refs use real or temp node ids. */
      inputs?: Record<string, WorkflowInputValue>;
      /** place the new node just after this node (real or temp id). */
      afterNodeId?: string;
    }
  | {
      kind: "connect";
      source: string;                      // real or temp id
      target: string;                      // real or temp id
      edgeType?: "default" | "conditional" | "else";
      branchLabel?: string;
      condition?: JsonLogicExpr;
    }
  | { kind: "remove-step"; nodeId: string }
  | { kind: "add-trigger"; tempId: string; triggerType: WorkflowNodeType; config?: Record<string, unknown> }
  | { kind: "remove-trigger"; nodeId: string }
  | {
      kind: "set-config";
      nodeId: string;
      patch: { model?: string | null; tools?: CanonicalTool[]; mcpInstanceIds?: string[]; sandboxId?: string };
    }
  | { kind: "new-custom-step"; tempId: string; step: CustomAiStepCreateInput };

export interface GraphPatch {
  summary: string;
  ops: PatchOp[];
}

export interface PatchValidationResult {
  ok: boolean;
  /** one human-readable reason per rejected op, keyed by op index. */
  errors: { opIndex: number; reason: string }[];
}
```

- [ ] **Step 2: Export from core**

Add to `packages/core/src/index.ts` (near the other `export type * from "./types/..."` lines):

```typescript
export type * from "./types/graph-patch.types.ts";
```

- [ ] **Step 3: Typecheck core**

Run: `npm run typecheck -w @journeyman/core`
Expected: PASS (types only, no logic).

---

## Task 2: The allow-list — `PATCHABLE_NODE_TYPES` (F8)

**Files:**
- Create: `packages/builder/src/graph-patch/node-types.ts`

- [ ] **Step 1: Write it**

```typescript
// packages/builder/src/graph-patch/node-types.ts
import type { WorkflowNodeType } from "@journeyman/core";

/**
 * The node types the AI is allowed to propose in v1 — the subset the assembler
 * knows how to wire correctly (F8). Deliberately smaller than the engine's
 * SUPPORTED_NODE_TYPES; grows as wiring logic is taught more (with tests).
 */
export const PATCHABLE_NODE_TYPES: ReadonlySet<WorkflowNodeType> = new Set<WorkflowNodeType>([
  "trigger-manual",
  "trigger-webhook",
  "trigger-human",
  "step",
  "human-task",
  "webhook-wait",
  "gateway-xor",
  "end",
]);

export function isPatchable(t: WorkflowNodeType): boolean {
  return PATCHABLE_NODE_TYPES.has(t);
}

/** Node types that start a flow — at most one of each may exist (F6). */
export const TRIGGER_NODE_TYPES: ReadonlySet<WorkflowNodeType> = new Set<WorkflowNodeType>([
  "trigger-manual",
  "trigger-webhook",
  "trigger-human",
]);
```

- [ ] **Step 2: Typecheck builder**

Run: `npm run typecheck -w @journeyman/builder`
Expected: PASS.

---

## Task 3: `validatePatch` — structural checks (F6, F8, H8)

**Files:**
- Create: `packages/builder/src/graph-patch/validate.test.ts`
- Create: `packages/builder/src/graph-patch/validate.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/builder/src/graph-patch/validate.test.ts
import { describe, it, expect } from "vitest";
import type { WorkflowGraph, PatchOp } from "@journeyman/core";
import { validatePatch } from "./validate.ts";

function graph(): WorkflowGraph {
  return {
    schemaVersion: 2,
    nodes: [
      { id: "trigger-manual_a1", type: "trigger-manual", config: {}, position: { x: 0, y: 0 } },
      { id: "step_pr", type: "step", stepType: "open-pull-request", config: {}, position: { x: 240, y: 0 } },
      { id: "end", type: "end", config: {}, position: { x: 480, y: 0 } },
    ],
    edges: [],
    inputDefs: [],
  };
}

describe("validatePatch", () => {
  it("accepts a valid add-step + connect referencing a temp id", () => {
    const ops: PatchOp[] = [
      { kind: "add-step", tempId: "t1", nodeType: "step", stepType: "send-message", afterNodeId: "step_pr" },
      { kind: "connect", source: "step_pr", target: "t1" },
    ];
    expect(validatePatch(graph(), ops).ok).toBe(true);
  });

  it("rejects a connect to a node that does not exist", () => {
    const r = validatePatch(graph(), [{ kind: "connect", source: "step_pr", target: "ghost" }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0].reason).toMatch(/unknown node|does not exist/i);
  });

  it("rejects a duplicate end node (F6)", () => {
    const r = validatePatch(graph(), [{ kind: "add-step", tempId: "t1", nodeType: "end" }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0].reason).toMatch(/end/i);
  });

  it("rejects a second trigger of a type already present (F6)", () => {
    const r = validatePatch(graph(), [{ kind: "add-trigger", tempId: "t1", triggerType: "trigger-manual" }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0].reason).toMatch(/trigger/i);
  });

  it("rejects a node type outside the allow-list (F8)", () => {
    const r = validatePatch(graph(), [{ kind: "add-step", tempId: "t1", nodeType: "loop" as never }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0].reason).toMatch(/not allowed|allow-list|cannot wire/i);
  });

  it("rejects set-config model on a non-AI step (H8)", () => {
    const r = validatePatch(graph(), [{ kind: "set-config", nodeId: "step_pr", patch: { model: "x" } }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0].reason).toMatch(/model|ai step/i);
  });

  it("allows set-config model on a custom-ai step", () => {
    const g = graph();
    g.nodes.push({ id: "step_ai", type: "step", stepType: "custom-ai", config: {}, position: { x: 360, y: 0 } });
    expect(validatePatch(g, [{ kind: "set-config", nodeId: "step_ai", patch: { model: "x" } }]).ok).toBe(true);
  });

  it("rejects duplicate temp ids in the same patch", () => {
    const ops: PatchOp[] = [
      { kind: "add-step", tempId: "t1", nodeType: "step", stepType: "a" },
      { kind: "add-step", tempId: "t1", nodeType: "step", stepType: "b" },
    ];
    const r = validatePatch(graph(), ops);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /duplicate/i.test(e.reason))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @journeyman/builder -- graph-patch/validate`
Expected: FAIL — `Cannot find module "./validate.ts"`.

- [ ] **Step 3: Implement `validate.ts`**

```typescript
// packages/builder/src/graph-patch/validate.ts
import type { WorkflowGraph, WorkflowNode, PatchOp, PatchValidationResult } from "@journeyman/core";
import { isPatchable, TRIGGER_NODE_TYPES } from "./node-types.ts";

const AI_STEP_TYPES = new Set(["custom-ai"]);
const AI_ONLY_CONFIG = new Set(["model", "tools", "mcpInstanceIds"]);

/** Validate a patch's ops against the current graph. Pure; never throws.
 *  Tracks temp ids added earlier in the same patch so later ops can reference them. */
export function validatePatch(graph: WorkflowGraph, ops: PatchOp[]): PatchValidationResult {
  const errors: PatchValidationResult["errors"] = [];
  const known = new Set(graph.nodes.map((n) => n.id));   // real + temp ids known so far
  const temps = new Set<string>();
  const nodeById = new Map<string, WorkflowNode>(graph.nodes.map((n) => [n.id, n]));
  const hasEnd = graph.nodes.some((n) => n.type === "end");
  const triggerTypes = new Set(graph.nodes.filter((n) => TRIGGER_NODE_TYPES.has(n.type)).map((n) => n.type));

  const fail = (i: number, reason: string) => errors.push({ opIndex: i, reason });

  ops.forEach((op, i) => {
    switch (op.kind) {
      case "add-step": {
        if (!isPatchable(op.nodeType)) { fail(i, `node type "${op.nodeType}" is not allowed (cannot wire it yet)`); break; }
        if (op.nodeType === "end" && (hasEnd || temps.has("__end__"))) { fail(i, `flow already has an end node`); break; }
        if (op.nodeType === "end") temps.add("__end__");
        if (temps.has(op.tempId) || known.has(op.tempId)) { fail(i, `duplicate id "${op.tempId}"`); break; }
        temps.add(op.tempId); known.add(op.tempId);
        break;
      }
      case "add-trigger": {
        if (!isPatchable(op.triggerType) || !TRIGGER_NODE_TYPES.has(op.triggerType)) { fail(i, `"${op.triggerType}" is not a valid trigger`); break; }
        if (triggerTypes.has(op.triggerType)) { fail(i, `flow already has a ${op.triggerType} trigger`); break; }
        if (temps.has(op.tempId) || known.has(op.tempId)) { fail(i, `duplicate id "${op.tempId}"`); break; }
        triggerTypes.add(op.triggerType); temps.add(op.tempId); known.add(op.tempId);
        break;
      }
      case "connect": {
        if (!known.has(op.source)) fail(i, `connect from unknown node "${op.source}"`);
        if (!known.has(op.target)) fail(i, `connect to unknown node "${op.target}"`);
        break;
      }
      case "remove-step":
      case "remove-trigger": {
        if (!nodeById.has(op.nodeId)) fail(i, `cannot remove unknown node "${op.nodeId}"`);
        break;
      }
      case "set-config": {
        const node = nodeById.get(op.nodeId);
        if (!node) { fail(i, `cannot configure unknown node "${op.nodeId}"`); break; }
        const isAi = node.type === "step" && node.stepType != null && AI_STEP_TYPES.has(node.stepType);
        for (const key of Object.keys(op.patch)) {
          if (AI_ONLY_CONFIG.has(key) && !isAi) { fail(i, `"${key}" only applies to an AI step, not "${node.stepType ?? node.type}"`); break; }
        }
        break;
      }
      case "new-custom-step": {
        if (temps.has(op.tempId) || known.has(op.tempId)) fail(i, `duplicate id "${op.tempId}"`);
        else { temps.add(op.tempId); }
        break;
      }
    }
  });

  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w @journeyman/builder -- graph-patch/validate`
Expected: PASS (all 8 cases).

---

## Task 4: `applyPatch` — turn ops into a new graph (F3, H3, H1-carry)

**Files:**
- Create: `packages/builder/src/graph-patch/apply.test.ts`
- Create: `packages/builder/src/graph-patch/apply.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/builder/src/graph-patch/apply.test.ts
import { describe, it, expect } from "vitest";
import type { WorkflowGraph, PatchOp } from "@journeyman/core";
import { applyPatch } from "./apply.ts";

function graph(): WorkflowGraph {
  return {
    schemaVersion: 2,
    nodes: [
      { id: "step_pr", type: "step", stepType: "open-pull-request", config: {}, position: { x: 240, y: 0 } },
      { id: "end", type: "end", config: {}, position: { x: 480, y: 0 } },
    ],
    edges: [],
    inputDefs: [],
  };
}

// Deterministic id generator for tests: prefix + incrementing counter.
function seqIds() {
  let n = 0;
  return (prefix: string) => `${prefix}_${++n}`;
}

const node = (g: WorkflowGraph, id: string) => g.nodes.find((x) => x.id === id);

describe("applyPatch", () => {
  it("adds a step, mints an editor-style id, and places it after its anchor", () => {
    const ops: PatchOp[] = [
      { kind: "add-step", tempId: "t1", nodeType: "step", stepType: "send-message", label: "Notify", afterNodeId: "step_pr" },
    ];
    const g = applyPatch(graph(), ops, { newId: seqIds() });
    const added = g.nodes.find((n) => n.stepType === "send-message")!;
    expect(added.id).toBe("step_1");
    expect(added.displayName).toBe("Notify");
    expect(added.position.x).toBe(240 + 240); // anchor.x + xStep
    expect(graph().nodes).toHaveLength(2);    // input graph unchanged (pure)
  });

  it("resolves a temp id when a later connect references the just-added step", () => {
    const ops: PatchOp[] = [
      { kind: "add-step", tempId: "t1", nodeType: "step", stepType: "send-message", afterNodeId: "step_pr" },
      { kind: "connect", source: "step_pr", target: "t1" },
    ];
    const g = applyPatch(graph(), ops, { newId: seqIds() });
    const added = g.nodes.find((n) => n.stepType === "send-message")!;
    const edge = g.edges.find((e) => e.source === "step_pr")!;
    expect(edge.target).toBe(added.id);  // temp "t1" rewritten to the real minted id
    expect(edge.type).toBe("default");
  });

  it("remaps a step-output input ref from a temp id to the real id (H1)", () => {
    const ops: PatchOp[] = [
      { kind: "add-step", tempId: "t1", nodeType: "step", stepType: "x" },
      { kind: "add-step", tempId: "t2", nodeType: "step", stepType: "y",
        inputs: { msg: { kind: "ref", ref: "t1.output.url" } } },
    ];
    const g = applyPatch(graph(), ops, { newId: seqIds() });
    const t1 = g.nodes.find((n) => n.stepType === "x")!;
    const t2 = g.nodes.find((n) => n.stepType === "y")!;
    expect((t2.inputs as Record<string, { kind: string; ref: string }>).msg.ref).toBe(`${t1.id}.output.url`);
  });

  it("set-config updates model on the target node", () => {
    const g0 = graph();
    g0.nodes.push({ id: "step_ai", type: "step", stepType: "custom-ai", config: {}, position: { x: 360, y: 0 } });
    const g = applyPatch(g0, [{ kind: "set-config", nodeId: "step_ai", patch: { model: "claude-opus-4-8" } }], { newId: seqIds() });
    expect(node(g, "step_ai")!.model).toBe("claude-opus-4-8");
  });

  it("remove-step drops the node and its touching edges", () => {
    const g0 = graph();
    g0.edges.push({ id: "e1", source: "step_pr", target: "end", type: "default" });
    const g = applyPatch(g0, [{ kind: "remove-step", nodeId: "step_pr" }], { newId: seqIds() });
    expect(node(g, "step_pr")).toBeUndefined();
    expect(g.edges).toHaveLength(0);
  });

  it("connect carries conditional branch metadata", () => {
    const g0 = graph();
    g0.nodes.push({ id: "g_1", type: "gateway-xor", config: {}, position: { x: 360, y: 0 } });
    const ops: PatchOp[] = [
      { kind: "connect", source: "g_1", target: "end", edgeType: "conditional", branchLabel: "passed",
        condition: { "==": [{ var: "step_pr.output.ok" }, true] } as never },
    ];
    const g = applyPatch(g0, ops, { newId: seqIds() });
    const e = g.edges.find((x) => x.source === "g_1")!;
    expect(e.type).toBe("conditional");
    expect(e.branchLabel).toBe("passed");
    expect(e.condition).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @journeyman/builder -- graph-patch/apply`
Expected: FAIL — `Cannot find module "./apply.ts"`.

- [ ] **Step 3: Implement `apply.ts`**

```typescript
// packages/builder/src/graph-patch/apply.ts
import type {
  WorkflowGraph, WorkflowNode, WorkflowEdge, WorkflowInputValue, PatchOp,
} from "@journeyman/core";

export interface ApplyOptions {
  /** id minter; defaults to the editor's random style. Tests inject a deterministic one. */
  newId?: (prefix: string) => string;
  /** horizontal spacing between columns (matches the assembler/editor grid). */
  xStep?: number;
}

function defaultNewId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Prefix used when minting a node's id, mirroring the editor's flow-graph.ts convention. */
function idPrefix(nodeType: string): string {
  return nodeType === "step" ? "step" : nodeType;
}

/**
 * Apply a patch to a graph, returning a NEW graph (pure — input untouched).
 * Resolves `tempId`s to freshly-minted real ids within this patch, so later ops
 * (connect / input refs / afterNodeId) can reference nodes added earlier.
 */
export function applyPatch(graph: WorkflowGraph, ops: PatchOp[], opts: ApplyOptions = {}): WorkflowGraph {
  const newId = opts.newId ?? defaultNewId;
  const xStep = opts.xStep ?? 240;
  let nodes: WorkflowNode[] = graph.nodes.map((n) => ({ ...n }));
  let edges: WorkflowEdge[] = graph.edges.map((e) => ({ ...e }));
  const temp = new Map<string, string>();              // tempId -> real id
  const resolve = (id: string): string => temp.get(id) ?? id;

  const maxX = () => (nodes.length ? Math.max(...nodes.map((n) => n.position?.x ?? 0)) : 0);

  for (const op of ops) {
    switch (op.kind) {
      case "add-step":
      case "add-trigger": {
        const type = op.kind === "add-step" ? op.nodeType : op.triggerType;
        const realId = newId(idPrefix(type));
        temp.set(op.tempId, realId);
        const anchorId = op.kind === "add-step" && op.afterNodeId ? resolve(op.afterNodeId) : undefined;
        const anchor = anchorId ? nodes.find((n) => n.id === anchorId) : undefined;
        const x = anchor ? (anchor.position?.x ?? 0) + xStep : (op.kind === "add-trigger" ? 0 : maxX() + xStep);
        const node: WorkflowNode = {
          id: realId, type, config: (op.kind === "add-step" ? op.config : op.config) ?? {}, position: { x, y: 0 },
        };
        if (op.kind === "add-step") {
          if (op.label) node.displayName = op.label;
          if (op.stepType) node.stepType = op.stepType;
          if (op.model != null) node.model = op.model;
          if (op.sandboxId) node.sandboxId = op.sandboxId;
          if (op.inputs) node.inputs = remapInputs(op.inputs, resolve);
        }
        nodes.push(node);
        break;
      }
      case "connect": {
        const edge: WorkflowEdge = {
          id: newId("e"), source: resolve(op.source), target: resolve(op.target), type: op.edgeType ?? "default",
        };
        if (op.branchLabel) edge.branchLabel = op.branchLabel;
        if (op.condition) edge.condition = op.condition;
        edges.push(edge);
        break;
      }
      case "remove-step":
      case "remove-trigger": {
        const id = resolve(op.nodeId);
        nodes = nodes.filter((n) => n.id !== id);
        edges = edges.filter((e) => e.source !== id && e.target !== id);
        break;
      }
      case "set-config": {
        const id = resolve(op.nodeId);
        nodes = nodes.map((n) => (n.id === id ? applySetConfig(n, op.patch) : n));
        break;
      }
      case "new-custom-step":
        // No graph change here — the caller records pending custom steps for
        // Save-time materialization, then rewrites refs. Nothing to apply now.
        break;
    }
  }

  return { ...graph, nodes, edges };
}

function applySetConfig(n: WorkflowNode, patch: { model?: string | null; tools?: unknown; mcpInstanceIds?: unknown; sandboxId?: string }): WorkflowNode {
  const next: WorkflowNode = { ...n, config: { ...(n.config ?? {}) } };
  if ("model" in patch) next.model = patch.model ?? null;
  if (patch.sandboxId !== undefined) next.sandboxId = patch.sandboxId;
  if (patch.tools !== undefined) (next.config as Record<string, unknown>).tools = patch.tools;
  if (patch.mcpInstanceIds !== undefined) (next.config as Record<string, unknown>).mcpInstanceIds = patch.mcpInstanceIds;
  return next;
}

/** Rewrite `<tempId>.output|input.<field>` refs inside input values to real ids. */
function remapInputs(inputs: Record<string, WorkflowInputValue>, resolve: (id: string) => string): Record<string, WorkflowInputValue> {
  const out: Record<string, WorkflowInputValue> = {};
  for (const [slot, value] of Object.entries(inputs)) out[slot] = remapValue(value, resolve);
  return out;
}

function remapValue(value: WorkflowInputValue, resolve: (id: string) => string): WorkflowInputValue {
  const v = value as { kind?: string; ref?: string; template?: string };
  if (v.kind === "ref" && typeof v.ref === "string") {
    const m = /^([^.]+)\.(output|input)\.(.+)$/.exec(v.ref);
    if (m) return { ...v, ref: `${resolve(m[1])}.${m[2]}.${m[3]}` } as WorkflowInputValue;
  }
  if (v.kind === "template" && typeof v.template === "string") {
    return { ...v, template: v.template.replace(/\{\{(.+?)\}\}/g, (full, inner) => {
      const mm = /^([^.]+)\.(output|input)\.(.+)$/.exec(String(inner).trim());
      return mm ? `{{ ${resolve(mm[1])}.${mm[2]}.${mm[3]} }}` : full;
    }) } as WorkflowInputValue;
  }
  return value;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w @journeyman/builder -- graph-patch/apply`
Expected: PASS (all 6 cases).

---

## Task 5: `patchFromIntent` — the create path

**Files:**
- Create: `packages/builder/src/graph-patch/from-intent.test.ts`
- Create: `packages/builder/src/graph-patch/from-intent.ts`

Reuses the existing `assemble(intent)` to build the full graph, then emits an all-`add` + `connect` patch (so "create" and "modify" share one apply/preview path).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/builder/src/graph-patch/from-intent.test.ts
import { describe, it, expect } from "vitest";
import type { AssemblerIntent } from "../assembler/intent.ts";
import { patchFromIntent } from "./from-intent.ts";
import { applyPatch } from "./apply.ts";

const intent: AssemblerIntent = {
  summary: "Notify on a manual trigger",
  triggers: [{ kind: "manual" }],
  steps: [
    { ref: "notify", kind: "provider", label: "Send message", stepType: "send-message", provider: "slack" },
  ],
};

function seqIds() { let n = 0; return (p: string) => `${p}_${++n}`; }

describe("patchFromIntent", () => {
  it("produces an all-add patch whose ops are every node + edge of the assembled graph", () => {
    const patch = patchFromIntent(intent);
    expect(patch.summary).toBe("Notify on a manual trigger");
    expect(patch.ops.some((o) => o.kind === "add-trigger")).toBe(true);
    expect(patch.ops.some((o) => o.kind === "add-step")).toBe(true);
    expect(patch.ops.some((o) => o.kind === "connect")).toBe(true);
  });

  it("applies onto an empty graph to a graph with the same node count as assemble()", () => {
    const patch = patchFromIntent(intent);
    const empty = { schemaVersion: 2 as const, nodes: [], edges: [], inputDefs: [] };
    const g = applyPatch(empty, patch.ops, { newId: seqIds() });
    // trigger + step + end = 3 nodes
    expect(g.nodes).toHaveLength(3);
    expect(g.nodes.some((n) => n.stepType === "send-message")).toBe(true);
    expect(g.nodes.some((n) => n.type === "end")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @journeyman/builder -- graph-patch/from-intent`
Expected: FAIL — `Cannot find module "./from-intent.ts"`.

- [ ] **Step 3: Implement `from-intent.ts`**

```typescript
// packages/builder/src/graph-patch/from-intent.ts
import type { GraphPatch, PatchOp, WorkflowNodeType } from "@journeyman/core";
import type { AssemblerIntent } from "../assembler/intent.ts";
import { assemble } from "../assembler/assemble.ts";

/**
 * Create path: assemble the whole graph from the intent, then express it as an
 * all-`add` + `connect` patch so create and modify share one apply/preview path.
 * The assembler's node ids become tempIds; `applyPatch` mints fresh real ids.
 */
export function patchFromIntent(intent: AssemblerIntent): GraphPatch {
  const { workflow } = assemble(intent);
  const ops: PatchOp[] = [];

  for (const n of workflow.nodes) {
    const isTrigger = n.type === "trigger-manual" || n.type === "trigger-webhook" || n.type === "trigger-human";
    if (isTrigger) {
      ops.push({ kind: "add-trigger", tempId: n.id, triggerType: n.type as WorkflowNodeType, config: n.config ?? {} });
    } else {
      ops.push({
        kind: "add-step",
        tempId: n.id,
        nodeType: n.type as WorkflowNodeType,
        label: n.displayName,
        stepType: n.stepType,
        config: n.config ?? {},
        model: n.model ?? undefined,
        sandboxId: n.sandboxId,
        inputs: n.inputs ?? undefined,
      });
    }
  }

  for (const e of workflow.edges) {
    ops.push({
      kind: "connect",
      source: e.source,
      target: e.target,
      edgeType: (e.type as "default" | "conditional" | "else") ?? "default",
      branchLabel: e.branchLabel,
      condition: e.condition,
    });
  }

  return { summary: intent.summary, ops };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w @journeyman/builder -- graph-patch/from-intent`
Expected: PASS.

> **Note:** the assembler emits sequential node ids (`t_1`, `n_1`, `end`). Here they're used only as **tempIds** within the patch; `applyPatch` mints fresh editor-style ids (F3), so the final graph never carries assembler-style ids. The `end` node is added as an `add-step` op with `nodeType: "end"` — correct for create (empty graph); `validatePatch` would reject it only on a graph that already has an end (F6), which is the modify case, not create.

---

## Task 6: Pure subpath export + barrel

**Files:**
- Create: `packages/builder/src/graph-patch/index.ts`
- Modify: `packages/builder/package.json`

- [ ] **Step 1: Write the barrel**

```typescript
// packages/builder/src/graph-patch/index.ts
export { applyPatch, type ApplyOptions } from "./apply.ts";
export { validatePatch } from "./validate.ts";
export { patchFromIntent } from "./from-intent.ts";
export { PATCHABLE_NODE_TYPES, TRIGGER_NODE_TYPES, isPatchable } from "./node-types.ts";
```

- [ ] **Step 2: Add the subpath export** to `packages/builder/package.json`

Find the `"exports"` block (or the `"main"` field) and add a `./graph-patch` entry alongside the existing root export. If the file currently has only `"main": "src/index.ts"`, add an `exports` map:

```json
  "exports": {
    ".": "./src/index.ts",
    "./graph-patch": "./src/graph-patch/index.ts"
  },
```

(If an `"exports"` map already exists, just add the `"./graph-patch": "./src/graph-patch/index.ts"` line. Match the existing pattern — see `packages/mcp/package.json`'s `./sdk-adapter` entry.)

- [ ] **Step 3: Verify the subpath stays pure** (core-only imports)

Run: `grep -rn "from \"@journeyman/" packages/builder/src/graph-patch/`
Expected: only `@journeyman/core` appears (no `pg`, no `ai`, no other `@journeyman/*` except via `../assembler/*` which itself imports only core). Confirm `../assembler/assemble.ts` and its imports (`intent`, `refs`, `gaps`, `conditions`) reference only `@journeyman/core`.

---

## Task 7: Full builder test run + repo-wide check

- [ ] **Step 1: Run the whole builder suite**

Run: `npm test -w @journeyman/builder`
Expected: PASS — the new `graph-patch/*` tests plus all pre-existing builder tests stay green.

- [ ] **Step 2: Repo-wide typecheck + import boundaries** (final gate — no commits)

Run: `npm run check`
Expected: PASS — typecheck across all workspaces + `✓ Layer boundaries clean across all packages.`

---

## Self-Review (completed during authoring)

- **Spec coverage (Phase 1 slice):** `GraphPatch`/`PatchOp` types (Task 1) ✓; F8 allow-list (Task 2) ✓; F6 dup start/end/trigger + H8 config-applies-to-kind + missing-node/dup-id validation (Task 3) ✓; F3 editor-style id minting + temp-id resolution + H1 input-ref remap + H3 placement-after-anchor (Task 4) ✓; create path `patchFromIntent` (Task 5) ✓; pure subpath for client+server reuse / detachability (Task 6) ✓. **Deferred to later plans (noted in spec phasing):** `serializeGraph` (F1) + typed-catalog (G1) → grounding plan; `resolveAnchors` (F2), patch route, agent patch-mode → phase 3; drawer/ghosts/revert (G2/G3/G7) → phase 4; Save-time materialization → phase 5. The G2 dependency-cascade and G3 accept-time re-validation are client orchestration built on these pure primitives — they belong with the drawer (phase 4); `validatePatch` already provides the re-check primitive G3 will call.
- **Placeholder scan:** none — every step has complete code/commands.
- **Type consistency:** `PatchOp` op shapes match across `validate.ts`, `apply.ts`, `from-intent.ts`; `applyPatch(graph, ops, opts)` and `validatePatch(graph, ops)` signatures match their tests; `newId(prefix)` injection is consistent; `add-trigger` carries `tempId` (used by both validate and apply). `WorkflowInputValue` ref shape (`{kind:"ref", ref}` / `{kind:"template", template}`) matches the assembler's `toInputValue` output used elsewhere.
