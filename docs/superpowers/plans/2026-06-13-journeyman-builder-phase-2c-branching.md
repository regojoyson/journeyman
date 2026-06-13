# Journeyman Builder — Phase 2c: Conditional Branching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the assembler so a flow can **branch**: after the main step chain, a `gateway-xor` node fans out into conditional arms (each a sub-chain ending at `end`) plus an optional `else` arm — emitting the exact `conditional`/`else` edge encoding the converter's `emitSwitch` accepts.

**Architecture:** Extend the existing `@journeyman/builder` assembler. The **edge model**: the gateway *follows the whole main chain* (`triggers → main steps → gateway`), then each branch is an independent arm (`gateway →(conditional) arm steps → end`), with one optional `else` arm. This avoids any node being both in the linear chain and a branch target. Conditions compile to JSONLogic with `var` paths remapped to assigned node ids.

**Tech Stack:** TypeScript (ESM, explicit `.ts` extensions), Vitest. Pure functions.

**Constraints (from the user):** **No `git commit` steps.** **Final step is `npm run check`.** Each task ends by running its tests.

**Scope (Phase 2c):** a single gateway after the main chain, ≥1 conditional branch + optional else, condition compilation, and gap/binding coverage of arm steps. **Out of scope:** mid-chain gateways, nested gateways, explicit join/merge nodes (arms each terminate at `end`).

**Reference:** Spec `docs/superpowers/specs/2026-06-13-journeyman-builder-design.md`. Builds on Phase 2a (the assembler).

**Verified encoding (from `conductor-converter.ts` `emitSwitch` + `jsonlogic-to-js.ts`):**
- gateway node type `gateway-xor`.
- each branch = an edge `type:"conditional"` with a **unique** `branchLabel` and a `condition` (`JsonLogicExpr`).
- one optional `type:"else"` edge (no condition / no branchLabel) = the default arm.
- condition `var` paths accept only `<nodeId>.output.<rest>` or `workflow.input.<rest>` (node id matches `[A-Za-z_][\w-]*`; `workflow.attribute.*` is NOT valid in conditions).
- `JsonLogicExpr` and operators (`==`,`!=`,`<`,`<=`,`>`,`>=`,`and`,`or`,`!`,`in`) are exported from `@journeyman/core`.

---

## File Structure (Phase 2c)

**Create:**
- `packages/builder/src/assembler/conditions.ts` — `compileCondition(intent, nodeIdByRef)` → `JsonLogicExpr`
- `packages/builder/src/assembler/conditions.test.ts`

**Modify:**
- `packages/builder/src/assembler/intent.ts` — add `ConditionIntent`, `BranchIntent`, `GatewayIntent`; add `gateway?` to `AssemblerIntent`
- `packages/builder/src/assembler/assemble.ts` — emit gateway + conditional/else edges + arms; flatten steps for bindings/gaps
- `packages/builder/src/assembler/assemble.test.ts` — add gateway tests (existing tests must still pass)
- `packages/builder/src/index.ts` — export `compileCondition` + the new intent types

---

## Task 1: Intent additions + condition compiler

**Files:**
- Modify: `packages/builder/src/assembler/intent.ts`
- Create: `packages/builder/src/assembler/conditions.ts`
- Test: `packages/builder/src/assembler/conditions.test.ts`

- [ ] **Step 1: Add branching types to `packages/builder/src/assembler/intent.ts`**

Append these to the end of the file:

```ts
/** A simple comparison the LLM expresses; compiled to a JSONLogic condition. */
export interface ConditionIntent {
  left:
    | { from: "step-output"; stepRef: string; field: string }
    | { from: "workflow-input"; name: string };
  op: "==" | "!=" | "<" | "<=" | ">" | ">=";
  right: string | number | boolean | null;
}

/** One conditional branch off a gateway. */
export interface BranchIntent {
  /** unique branchLabel among the gateway's conditional edges. */
  label: string;
  condition: ConditionIntent;
  /** the arm's steps (a sub-chain); empty ⇒ branch goes straight to end. */
  steps: StepIntent[];
}

/** A gateway placed after the main step chain. */
export interface GatewayIntent {
  ref: string;
  label: string;
  branches: BranchIntent[]; // >= 1
  elseBranch?: { steps: StepIntent[] };
}
```

And add a `gateway` field to the existing `AssemblerIntent` interface (insert after `steps`):

```ts
  /** optional branch point after the main chain. */
  gateway?: GatewayIntent;
```

- [ ] **Step 2: Write the failing test for the compiler**

Create `packages/builder/src/assembler/conditions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { compileCondition } from "./conditions.ts";

describe("compileCondition", () => {
  it("compiles a step-output comparison, remapping the step ref to its node id", () => {
    expect(
      compileCondition(
        { left: { from: "step-output", stepRef: "test", field: "passed" }, op: "==", right: true },
        { test: "n_1" },
      ),
    ).toEqual({ "==": [{ var: "n_1.output.passed" }, true] });
  });

  it("compiles a workflow-input comparison", () => {
    expect(
      compileCondition({ left: { from: "workflow-input", name: "sev" }, op: ">", right: 3 }, {}),
    ).toEqual({ ">": [{ var: "workflow.input.sev" }, 3] });
  });

  it("falls back to the raw stepRef when it is not in the id map", () => {
    expect(
      compileCondition({ left: { from: "step-output", stepRef: "x", field: "y" }, op: "!=", right: null }, {}),
    ).toEqual({ "!=": [{ var: "x.output.y" }, null] });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/assembler/conditions.test.ts`
Expected: FAIL — cannot resolve `./conditions.ts`.

- [ ] **Step 4: Create `packages/builder/src/assembler/conditions.ts`**

```ts
import type { JsonLogicExpr } from "@journeyman/core";
import type { ConditionIntent } from "./intent.ts";

/**
 * Compile a ConditionIntent into a JSONLogic expression, remapping a
 * step-output's intent handle to its assigned node id. Produces a `var` path
 * the converter accepts: `<nodeId>.output.<field>` or `workflow.input.<name>`.
 */
export function compileCondition(
  c: ConditionIntent,
  nodeIdByRef: Record<string, string>,
): JsonLogicExpr {
  const path =
    c.left.from === "step-output"
      ? `${nodeIdByRef[c.left.stepRef] ?? c.left.stepRef}.output.${c.left.field}`
      : `workflow.input.${c.left.name}`;
  return { [c.op]: [{ var: path }, c.right] } as JsonLogicExpr;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/builder/src/assembler/conditions.test.ts`
Expected: PASS (3 tests).

---

## Task 2: Emit the gateway, arms, and branch edges

**Files:**
- Modify: `packages/builder/src/assembler/assemble.ts`
- Test: `packages/builder/src/assembler/assemble.test.ts`

This replaces `assemble.ts` with a version that (a) preserves the linear no-gateway behavior exactly, and (b) when `intent.gateway` is present, links the main chain into the gateway and fans out to arms. Node ids for *all* steps (main + arms + else) are assigned up front so refs/conditions resolve regardless of arm.

- [ ] **Step 1: Add the gateway tests (existing tests stay)**

Append to `packages/builder/src/assembler/assemble.test.ts` (inside the existing top-level scope, after the current `describe`):

```ts
describe("assemble — branching", () => {
  it("emits a gateway after the main chain with conditional + else edges and arm nodes", () => {
    const intent: import("./intent.ts").AssemblerIntent = {
      summary: "",
      triggers: [{ kind: "manual" }],
      steps: [{ ref: "test", kind: "ai", label: "Run tests", stepType: "custom-ai", customStepId: "tmp-t" }],
      gateway: {
        ref: "gate", label: "Pass?",
        branches: [{
          label: "pass",
          condition: { left: { from: "step-output", stepRef: "test", field: "passed" }, op: "==", right: true },
          steps: [{ ref: "ok", kind: "provider", label: "Comment pass", stepType: "comment-on-pull-request", provider: "github" }],
        }],
        elseBranch: { steps: [{ ref: "bad", kind: "provider", label: "Comment fail", stepType: "comment-on-pull-request", provider: "github" }] },
      },
    };
    const { workflow } = assemble(intent, {});
    const gw = workflow.nodes.find((n) => n.type === "gateway-xor")!;
    expect(gw).toBeDefined();
    const testNode = workflow.nodes.find((n) => n.config?.customStepId === "tmp-t")!;
    // last main step → gateway
    expect(workflow.edges.some((e) => e.source === testNode.id && e.target === gw.id)).toBe(true);
    // conditional edge with branchLabel + compiled condition referencing the test node id
    const cond = workflow.edges.find((e) => e.type === "conditional")!;
    expect(cond.source).toBe(gw.id);
    expect(cond.branchLabel).toBe("pass");
    expect(cond.condition).toEqual({ "==": [{ var: `${testNode.id}.output.passed` }, true] });
    // else edge from gateway
    expect(workflow.edges.some((e) => e.type === "else" && e.source === gw.id)).toBe(true);
    // both arm nodes present
    expect(workflow.nodes.filter((n) => n.stepType === "comment-on-pull-request")).toHaveLength(2);
    // every edge endpoint exists
    const ids = new Set(workflow.nodes.map((n) => n.id));
    for (const e of workflow.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it("detects gaps inside branch arms", () => {
    const intent: import("./intent.ts").AssemblerIntent = {
      summary: "", triggers: [{ kind: "manual" }], steps: [],
      gateway: {
        ref: "g", label: "x",
        branches: [{
          label: "a",
          condition: { left: { from: "workflow-input", name: "sev" }, op: "==", right: "high" },
          steps: [{ ref: "n", kind: "provider", label: "Slack", stepType: "send-message", provider: "slack" }],
        }],
      },
    };
    const { gaps } = assemble(intent, {});
    expect(gaps.some((gp) => gp.kind === "not-implemented")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the gateway tests to verify they fail**

Run: `npx vitest run packages/builder/src/assembler/assemble.test.ts`
Expected: FAIL — `gateway` is not yet handled (no `gateway-xor` node emitted).

- [ ] **Step 3: Replace `packages/builder/src/assembler/assemble.ts` with the gateway-aware version**

```ts
import type {
  WorkflowGraph, WorkflowNode, WorkflowEdge, WorkflowNodeType,
  WorkflowInputDef, WorkflowInputValue, StepBinding, Gap, StepKind,
} from "@journeyman/core";
import { WORKFLOW_SCHEMA_VERSION } from "@journeyman/core";
import type { AssemblerIntent, StepIntent, TriggerIntent, InputIntent } from "./intent.ts";
import { toInputValue } from "./refs.ts";
import { detectGaps } from "./gaps.ts";
import { compileCondition } from "./conditions.ts";

export interface AssembleDeps {
  /** Reserved for future catalog-driven checks; unused so far. */
  catalog?: unknown;
}

export interface AssembleResult {
  workflow: WorkflowGraph;
  stepBindings: StepBinding[];
  gaps: Gap[];
}

const X_STEP = 240;
const Y = 0;

function triggerNodeType(t: TriggerIntent): WorkflowNodeType {
  switch (t.kind) {
    case "manual":  return "trigger-manual";
    case "webhook": return "trigger-webhook";
    case "form":    return "trigger-human";
  }
}

function stepNodeType(s: StepIntent): WorkflowNodeType {
  if (s.kind === "human-task") return "human-task";
  if (s.kind === "webhook-wait") return "webhook-wait";
  return "step";
}

function bindingKind(s: StepIntent): StepKind {
  if (s.kind === "human-task") return "human-task";
  if (s.kind === "webhook-wait") return "webhook-wait";
  if (s.kind === "ai") return "ai";
  return "provider";
}

export function assemble(intent: AssemblerIntent, _deps: AssembleDeps = {}): AssembleResult {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  const inputDefs: WorkflowInputDef[] = [];
  const triggerNodeIds: string[] = [];
  const nodeIdByRef: Record<string, string> = {};
  let edgeSeq = 0;
  let stepSeq = 0;
  let col = 0;
  const edge = (source: string, target: string, extra: Partial<WorkflowEdge> = {}): WorkflowEdge => ({
    id: `e_${++edgeSeq}`, source, target, type: "default", ...extra,
  });

  // --- Triggers ---
  intent.triggers.forEach((t, i) => {
    const id = `t_${i + 1}`;
    triggerNodeIds.push(id);
    const config: Record<string, unknown> = {};
    if (t.kind === "webhook") {
      config.webhookId = t.webhookId ?? "";
      if (t.listensFor) config.listensFor = t.listensFor;
      const mapping: Record<string, { fromPath: string; type: string }> = {};
      for (const inp of t.inputs ?? []) {
        mapping[inp.name] = { fromPath: inp.fromPath, type: inp.type };
        inputDefs.push({ name: inp.name, type: inp.type });
      }
      config.inputsMapping = mapping;
    } else if (t.kind === "form") {
      config.fieldOverrides = {};
      for (const inp of t.inputs ?? []) inputDefs.push({ name: inp.name, type: inp.type });
    }
    nodes.push({ id, type: triggerNodeType(t), displayName: t.kind, config, position: { x: col * X_STEP, y: Y } });
  });
  col += 1;

  // --- Assign node ids for ALL steps (main + branch arms + else) up front ---
  const branchSteps = intent.gateway?.branches.flatMap((b) => b.steps) ?? [];
  const elseSteps = intent.gateway?.elseBranch?.steps ?? [];
  const allSteps: StepIntent[] = [...intent.steps, ...branchSteps, ...elseSteps];
  for (const s of allSteps) nodeIdByRef[s.ref] = `n_${++stepSeq}`;

  // --- Per-step node builder (closes over nodeIdByRef) ---
  const buildStepNode = (s: StepIntent, c: number): WorkflowNode => {
    const node: WorkflowNode = {
      id: nodeIdByRef[s.ref], type: stepNodeType(s), displayName: s.label,
      position: { x: c * X_STEP, y: Y },
    };
    const config: Record<string, unknown> = {};
    if (node.type === "step") {
      node.stepType = s.stepType;
      if (s.stepType === "custom-ai" && s.customStepId) config.customStepId = s.customStepId;
      if (s.kind === "ai") {
        if (s.tools) config.tools = s.tools;
        if (s.mcpIds) config.mcpInstanceIds = s.mcpIds;
        if (s.skillIds) config.skillIds = s.skillIds;
      }
      if (s.provider) node.executorConfig = { provider: s.provider };
      if (s.model) node.model = s.model;
      if (s.sandboxId) node.sandboxId = s.sandboxId;
    } else if (node.type === "webhook-wait") {
      config.webhookId = s.waitWebhookId ?? "";
    } else if (node.type === "human-task") {
      if (s.assignee) config.assignee = s.assignee;
      if (s.taskPrompt) config.prompt = s.taskPrompt;
    }
    node.config = config;
    if (s.inputs && s.inputs.length > 0) {
      const inputs: Record<string, WorkflowInputValue> = {};
      for (const b of s.inputs) inputs[b.slot] = toInputValue(remapInput(b.value, nodeIdByRef));
      node.inputs = inputs;
    }
    return node;
  };

  const endId = "end";

  // --- Main chain nodes + edges ---
  const mainIds = intent.steps.map((s) => nodeIdByRef[s.ref]);
  intent.steps.forEach((s) => { nodes.push(buildStepNode(s, col++)); });
  for (let i = 0; i < mainIds.length - 1; i++) edges.push(edge(mainIds[i], mainIds[i + 1]));

  if (intent.gateway) {
    const g = intent.gateway;
    const gId = "g_1";
    // triggers → first main step, or directly to the gateway if there are no main steps
    const firstTarget = mainIds[0] ?? gId;
    for (const tId of triggerNodeIds) edges.push(edge(tId, firstTarget));
    // last main step → gateway
    if (mainIds.length) edges.push(edge(mainIds[mainIds.length - 1], gId));
    nodes.push({ id: gId, type: "gateway-xor", displayName: g.label, config: {}, position: { x: col++ * X_STEP, y: Y } });

    const buildArm = (steps: StepIntent[], gatewayEdgeExtra: Partial<WorkflowEdge>) => {
      const armIds = steps.map((s) => nodeIdByRef[s.ref]);
      steps.forEach((s) => nodes.push(buildStepNode(s, col++)));
      edges.push(edge(gId, armIds[0] ?? endId, gatewayEdgeExtra));
      for (let i = 0; i < armIds.length - 1; i++) edges.push(edge(armIds[i], armIds[i + 1]));
      if (armIds.length) edges.push(edge(armIds[armIds.length - 1], endId));
    };
    for (const b of g.branches) {
      buildArm(b.steps, { type: "conditional", branchLabel: b.label, condition: compileCondition(b.condition, nodeIdByRef) });
    }
    if (g.elseBranch) buildArm(g.elseBranch.steps, { type: "else" });
  } else {
    // No gateway: plain linear chain (unchanged behavior).
    const firstTarget = mainIds[0] ?? endId;
    for (const tId of triggerNodeIds) edges.push(edge(tId, firstTarget));
    if (mainIds.length) edges.push(edge(mainIds[mainIds.length - 1], endId));
  }

  // --- end node ---
  nodes.push({ id: endId, type: "end", displayName: "End", config: {}, position: { x: col * X_STEP, y: Y } });

  // --- step bindings (all steps, main + arms) ---
  const stepBindings: StepBinding[] = allSteps.map((s) => buildBinding(s, nodeIdByRef));

  // --- gaps (flatten arm steps into the intent passed to detectGaps) ---
  const gaps = detectGaps(
    { summary: intent.summary, triggers: intent.triggers, steps: allSteps },
    { nodeIdByRef, triggerNodeIds },
  );

  const workflow: WorkflowGraph = { schemaVersion: WORKFLOW_SCHEMA_VERSION, nodes, edges, inputDefs };
  return { workflow, stepBindings, gaps };
}

function buildBinding(s: StepIntent, nodeIdByRef: Record<string, string>): StepBinding {
  const uses: StepBinding["uses"] = {};
  if (s.kind === "ai") {
    if (s.tools) uses.tools = s.tools;
    if (s.mcpIds) uses.mcpIds = s.mcpIds;
    if (s.skillIds) uses.skillIds = s.skillIds;
    if (s.model) uses.model = s.model;
  } else if (s.kind === "provider" && s.connection) {
    uses.connection = s.connection;
  }
  if (s.sandboxId) uses.sandboxId = s.sandboxId;
  if (s.secrets) uses.secrets = s.secrets;
  const inputs = (s.inputs ?? []).map((b) => ({ name: b.slot, from: describeFrom(b.value) }));
  return { nodeId: nodeIdByRef[s.ref], stepKind: bindingKind(s), uses, io: { inputs, outputs: [] } };
}

/** Rewrite an InputIntent's intent-local step handles to assigned node ids. */
function remapInput(v: InputIntent, nodeIdByRef: Record<string, string>): InputIntent {
  if (v.from === "step-output") return { ...v, stepRef: nodeIdByRef[v.stepRef] ?? v.stepRef };
  if (v.from === "template") return { from: "template", template: remapTemplate(v.template, nodeIdByRef) };
  return v;
}

/** In a `{{ ref }}` template, rewrite `<intentRef>.output|input.<field>` tokens to node ids. */
function remapTemplate(tpl: string, nodeIdByRef: Record<string, string>): string {
  return tpl.replace(/\{\{(.+?)\}\}/g, (full, inner) => {
    const ref = String(inner).trim();
    const m = /^([^.]+)\.(output|input)\.(.+)$/.exec(ref);
    if (m && nodeIdByRef[m[1]]) return `{{ ${nodeIdByRef[m[1]]}.${m[2]}.${m[3]} }}`;
    return full;
  });
}

/** Human-readable source description for the inputs/outputs (⇄) reveal. */
function describeFrom(v: InputIntent): string {
  switch (v.from) {
    case "literal":            return "a fixed value";
    case "workflow-input":     return `flow input ${v.name}`;
    case "workflow-attribute": return `flow attribute ${v.name}`;
    case "step-output":        return `step ${v.stepRef} · output ${v.field}`;
    case "template":           return "a template";
    default:                   return "unknown";
  }
}
```

- [ ] **Step 4: Run the assembler tests (old + new) to verify all pass**

Run: `npx vitest run packages/builder/src/assembler/assemble.test.ts`
Expected: PASS — the 4 original structure tests (linear behavior unchanged) plus the 2 new branching tests.

---

## Task 3: Export + full package test

**Files:**
- Modify: `packages/builder/src/index.ts`

- [ ] **Step 1: Export the compiler and the new intent types**

In `packages/builder/src/index.ts`, extend the assembler exports:

```ts
export { compileCondition } from "./assembler/conditions.ts";
export type { ConditionIntent, BranchIntent, GatewayIntent } from "./assembler/intent.ts";
```

- [ ] **Step 2: Run the whole builder package's tests**

Run: `npm test -w @journeyman/builder`
Expected: PASS — all prior suites plus `conditions.test.ts` and the extended `assemble.test.ts`.

---

## Final: Typecheck the whole repo (no commit)

- [ ] **Step 1: Run the full type + import-boundary check**

Run: `npm run check`
Expected: PASS — `npm run typecheck` (all workspaces incl. `@journeyman/builder`) and `npm run check:boundaries` (clean). **Do not commit** — leave changes for review.

---

## Self-review checklist (run before handoff)

- **Spec coverage (Phase 2c slice):** gateway after the main chain ✓; conditional edges with unique `branchLabel` + compiled `condition` ✓; optional `else` edge ✓; condition `var` paths remapped to node ids and limited to `<nodeId>.output` / `workflow.input` ✓ (Task 1 compiler); arm steps covered by bindings + gaps ✓ (Task 2 flatten). Mid-chain/nested gateways + explicit joins are out of scope.
- **No placeholders:** every code step has complete code; every run step has a command + expected result.
- **Type consistency:** `ConditionIntent`/`BranchIntent`/`GatewayIntent` added to `intent.ts` (Task 1) and consumed by `conditions.ts` + `assemble.ts`; `compileCondition` signature matches between definition and call; `JsonLogicExpr` imported from core (confirmed exported).
- **No regressions:** the rewritten `assemble.ts` keeps the no-gateway path byte-for-byte equivalent in behavior (trigger→first, chain, last→end), verified by the 4 original tests still passing.
- **Edge fidelity:** conditional edges carry `type:"conditional"` + `branchLabel` + `condition`; the else edge carries `type:"else"` with neither — exactly what `emitSwitch` validates.
- **No commit steps anywhere; final step is `npm run check`.** ✓
