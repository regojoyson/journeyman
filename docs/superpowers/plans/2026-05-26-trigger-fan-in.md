# Trigger Fan-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow multiple trigger nodes (manual + webhook + human) to all point to the same downstream step without a Join, so the original triggers design ("triggers feed the same downstream graph") is actually publishable.

**Architecture:** Single change to the publish validator — extend the existing "max 1 incoming default edge" loop in `packages/core/src/validation/validate-for-publish.ts` so that a non-trigger, non-join, non-end node may have multiple incoming edges if **every** incoming edge's source is a trigger node. No data-model, runtime, UI, fork/join, or orchestrator change.

**Tech Stack:** TypeScript, Vitest, `@journeyman/core`.

**Spec:** [`docs/superpowers/specs/2026-05-26-trigger-fan-in-design.md`](../specs/2026-05-26-trigger-fan-in-design.md)

---

## File Structure

| File | Role | Action |
|---|---|---|
| `packages/core/src/validation/validate-for-publish.ts` | Publish-time graph validator. Holds the "max 1 incoming" rule we're loosening. | Modify (lines 132–150). |
| `packages/core/src/validation/validate-for-publish.trigger-fan-in.test.ts` | New focused test file for trigger fan-in cases. Sits next to other validation tests; mirrors the naming style of `validate-workflow.mcp-required.test.ts`. | Create. |

Test framework: **Vitest**. Run from repo root with `npm test --workspace @journeyman/core` or from `packages/core` with `npm test`. Use `vitest run path/to/file.test.ts` for a single file.

---

## Task 1: Add failing tests for trigger fan-in

**Files:**
- Create: `packages/core/src/validation/validate-for-publish.trigger-fan-in.test.ts`

- [ ] **Step 1: Create the test file with all five spec cases**

Create `packages/core/src/validation/validate-for-publish.trigger-fan-in.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateForPublish, type PublishValidationContext } from "./validate-for-publish.ts";
import type { WorkflowGraph } from "../types/flow.types.ts";

const ctx: PublishValidationContext = {
  hasTrigger: true,
  visibleSecretNames: new Set(),
  visibleMcpInstanceIds: new Set(),
  visibleSkillIds: new Set(),
};

/** Helper: build a graph with the given nodes/edges and v2 schema. */
function graph(nodes: WorkflowGraph["nodes"], edges: WorkflowGraph["edges"]): WorkflowGraph {
  return {
    schemaVersion: 2,
    inputs: [],
    nodes,
    edges,
  } as unknown as WorkflowGraph;
}

/** Trigger node factory. */
function trigger(id: string, type: "trigger-manual" | "trigger-webhook" | "trigger-human") {
  const config = type === "trigger-webhook"
    ? { webhookId: "wh-1", inputsMapping: {} }
    : type === "trigger-human"
      ? { fieldOverrides: {} }
      : {};
  return {
    id,
    type,
    displayName: type,
    config,
    position: { x: 0, y: 0 },
  } as unknown as WorkflowGraph["nodes"][number];
}

function step(id: string, stepType: string) {
  return {
    id,
    type: "step",
    stepType,
    displayName: id,
    config: {},
    position: { x: 100, y: 0 },
  } as unknown as WorkflowGraph["nodes"][number];
}

function endNode(id = "end") {
  return {
    id,
    type: "end",
    displayName: "End",
    config: {},
    position: { x: 200, y: 0 },
  } as unknown as WorkflowGraph["nodes"][number];
}

function edge(id: string, source: string, target: string) {
  return { id, source, target, type: "default" } as unknown as WorkflowGraph["edges"][number];
}

/** Pick out the "has N incoming arrows" errors, which is what this rule emits. */
function fanInErrors(flow: WorkflowGraph) {
  const result = validateForPublish(flow, ctx);
  return result.errors.filter(e => e.message.includes("incoming arrows"));
}

describe("validateForPublish — trigger fan-in", () => {
  it("allows two triggers (manual + webhook) into one step", () => {
    const flow = graph(
      [
        trigger("t-manual", "trigger-manual"),
        trigger("t-webhook", "trigger-webhook"),
        step("get-ticket", "get-ticket"),
        endNode(),
      ],
      [
        edge("e1", "t-manual", "get-ticket"),
        edge("e2", "t-webhook", "get-ticket"),
        edge("e3", "get-ticket", "end"),
      ],
    );
    expect(fanInErrors(flow)).toEqual([]);
  });

  it("allows three triggers (manual + webhook + human) into one step", () => {
    const flow = graph(
      [
        trigger("t-manual", "trigger-manual"),
        trigger("t-webhook", "trigger-webhook"),
        trigger("t-human", "trigger-human"),
        step("get-ticket", "get-ticket"),
        endNode(),
      ],
      [
        edge("e1", "t-manual", "get-ticket"),
        edge("e2", "t-webhook", "get-ticket"),
        edge("e3", "t-human", "get-ticket"),
        edge("e4", "get-ticket", "end"),
      ],
    );
    expect(fanInErrors(flow)).toEqual([]);
  });

  it("rejects mixed fan-in (trigger + regular step into same target)", () => {
    const flow = graph(
      [
        trigger("t-manual", "trigger-manual"),
        step("first", "noop"),
        step("target", "get-ticket"),
        endNode(),
      ],
      [
        edge("e1", "t-manual", "first"),
        edge("e2", "first", "target"),
        edge("e3", "t-manual", "target"), // mixed: trigger + step both point at target
        edge("e4", "target", "end"),
      ],
    );
    const errs = fanInErrors(flow);
    expect(errs).toHaveLength(1);
    expect(errs[0].nodeId).toBe("target");
    expect(errs[0].message).toContain("Join");
  });

  it("still rejects two regular steps fanning into the same target (no regression)", () => {
    const flow = graph(
      [
        trigger("t-manual", "trigger-manual"),
        step("a", "noop"),
        step("b", "noop"),
        step("target", "get-ticket"),
        endNode(),
      ],
      [
        edge("e1", "t-manual", "a"),
        edge("e2", "t-manual", "b"),
        edge("e3", "a", "target"),
        edge("e4", "b", "target"),
        edge("e5", "target", "end"),
      ],
    );
    const errs = fanInErrors(flow);
    expect(errs).toHaveLength(1);
    expect(errs[0].nodeId).toBe("target");
  });

  it("allows a single trigger → single step (existing behavior unchanged)", () => {
    const flow = graph(
      [
        trigger("t-manual", "trigger-manual"),
        step("get-ticket", "get-ticket"),
        endNode(),
      ],
      [
        edge("e1", "t-manual", "get-ticket"),
        edge("e2", "get-ticket", "end"),
      ],
    );
    expect(fanInErrors(flow)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail in the expected places**

Run from repo root:

```bash
npm test --workspace @journeyman/core -- validate-for-publish.trigger-fan-in
```

Expected output:
- "allows two triggers (manual + webhook) into one step" → **FAIL** (errors array is non-empty, contains the "incoming arrows" error for `get-ticket`)
- "allows three triggers (manual + webhook + human) into one step" → **FAIL** (same reason)
- "rejects mixed fan-in (trigger + regular step into same target)" → **PASS** (error already exists)
- "still rejects two regular steps fanning into the same target (no regression)" → **PASS** (error already exists)
- "allows a single trigger → single step (existing behavior unchanged)" → **PASS** (single edge, no error)

If the two FAIL cases fail for the right reason ("incoming arrows" error present on `get-ticket`), proceed. If they fail for any other reason (e.g. schema parse error), fix the test scaffolding first — the validator change in Task 2 won't help.

- [ ] **Step 3: Commit the failing tests**

```bash
git add packages/core/src/validation/validate-for-publish.trigger-fan-in.test.ts
git commit -m "test(core): failing tests for trigger fan-in validation"
```

---

## Task 2: Loosen the validator to allow all-from-triggers fan-in

**Files:**
- Modify: `packages/core/src/validation/validate-for-publish.ts:132-150`

- [ ] **Step 1: Read the current loop**

Open `packages/core/src/validation/validate-for-publish.ts` and locate the block at lines 127–150. It looks like:

```typescript
  // Only Join and End may legitimately aggregate multiple upstream branches.
  // Every other node type (regular step, If, Fork, Loop, Human Task, etc.)
  // is single-input — multiple incoming default edges would mean the worker
  // can't decide which upstream's output to use and may execute the node more
  // than once. Triggers are checked separately above.
  const defaultIncomingCount = new Map<string, number>();
  for (const e of flow.edges) {
    if ((e.type ?? "default") !== "default") continue;
    defaultIncomingCount.set(e.target, (defaultIncomingCount.get(e.target) ?? 0) + 1);
  }
  for (const node of flow.nodes) {
    if (node.type === "join" || node.type === "end") continue;
    if (isTriggerNode(node)) continue;
    const n = defaultIncomingCount.get(node.id) ?? 0;
    if (n > 1) {
      const label = nodeLabelFor(node);
      errors.push({
        code: "graph_invalid",
        message: `"${label}" has ${n} incoming arrows. To merge multiple paths into a single step, add a Join node before it — the Join will wait for the upstream branches and then continue into "${label}".`,
        nodeId: node.id,
        nodeLabel: label,
      });
    }
  }
```

- [ ] **Step 2: Apply the change**

We need two things:
1. A `nodeById` lookup so we can resolve each incoming edge's source to its node and ask `isTriggerNode`.
2. An additional skip condition: if `n > 1` AND every incoming default edge's source is a trigger node, allow it.

Replace the block above with this:

```typescript
  // Only Join and End may legitimately aggregate multiple upstream branches.
  // Every other node type (regular step, If, Fork, Loop, Human Task, etc.)
  // is single-input — multiple incoming default edges would mean the worker
  // can't decide which upstream's output to use and may execute the node more
  // than once. Triggers are checked separately above.
  //
  // Exception: a node may have multiple incoming default edges if ALL of
  // them originate from trigger nodes. Each trigger fires its own workflow
  // instance, so at runtime only one upstream is ever active — there's no
  // worker ambiguity. This expresses the "triggers share a downstream graph"
  // rule from the workflow-trigger-nodes design.
  const defaultIncomingByTarget = new Map<string, string[]>();
  for (const e of flow.edges) {
    if ((e.type ?? "default") !== "default") continue;
    const list = defaultIncomingByTarget.get(e.target);
    if (list) list.push(e.source);
    else defaultIncomingByTarget.set(e.target, [e.source]);
  }
  const nodeById = new Map(flow.nodes.map(n => [n.id, n] as const));
  for (const node of flow.nodes) {
    if (node.type === "join" || node.type === "end") continue;
    if (isTriggerNode(node)) continue;
    const sources = defaultIncomingByTarget.get(node.id) ?? [];
    if (sources.length <= 1) continue;
    const allFromTriggers = sources.every(srcId => {
      const src = nodeById.get(srcId);
      return src !== undefined && isTriggerNode(src);
    });
    if (allFromTriggers) continue;
    const label = nodeLabelFor(node);
    errors.push({
      code: "graph_invalid",
      message: `"${label}" has ${sources.length} incoming arrows. To merge multiple paths into a single step, add a Join node before it — the Join will wait for the upstream branches and then continue into "${label}".`,
      nodeId: node.id,
      nodeLabel: label,
    });
  }
```

Notes on the change:
- `defaultIncomingCount` (Map<string, number>) becomes `defaultIncomingByTarget` (Map<string, string[]>) so we have the source IDs, not just the count. `sources.length` replaces the old count.
- `nodeById` is built once outside the loop (O(N) instead of N×N).
- `allFromTriggers` only matters when `sources.length > 1`, so the early `continue` skips the cheap path.
- The error message uses `sources.length` instead of the old `n`; same numeric value.

- [ ] **Step 3: Run the trigger-fan-in tests to verify they now pass**

```bash
npm test --workspace @journeyman/core -- validate-for-publish.trigger-fan-in
```

Expected: all 5 tests PASS.

- [ ] **Step 4: Run the full core test suite to check for regressions**

```bash
npm test --workspace @journeyman/core
```

Expected: all tests PASS. If anything else fails, investigate before continuing — the change is small and shouldn't affect other validators, but other tests may have been written against the old `defaultIncomingCount` variable name (unlikely, since it was local to the function).

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck --workspace @journeyman/core
```

Expected: no errors.

- [ ] **Step 6: Import-boundary check (repo root)**

```bash
npm run check:boundaries
```

Expected: no errors.

- [ ] **Step 7: Commit the fix**

```bash
git add packages/core/src/validation/validate-for-publish.ts
git commit -m "fix(core): allow trigger fan-in into shared downstream step

A non-trigger step may now have multiple incoming default edges if every
edge originates from a trigger node. Implements the 'triggers share a
downstream graph' rule from the workflow-trigger-nodes design.

Mixed fan-in (trigger + regular step) and step-only fan-in still require
a Join, so fork/join discipline is unchanged."
```

---

## Task 3: End-to-end manual verification

**Files:** none (UI verification only).

- [ ] **Step 1: Start the dev stack**

From repo root:

```bash
npm run infra:up
npm run start:api-server    # in one terminal
npm run start:worker        # in another
npm run dev:web             # in another
```

- [ ] **Step 2: Reproduce the original failure case in the flow editor**

Open the web UI, create a new flow, and build this graph by dragging from the palette:

1. Drop `Manual` trigger.
2. Drop `Webhook` trigger.
3. Drop `Get Issue` step (configure with a placeholder `ref` so the missing-input error goes away — or ignore that error; it's unrelated).
4. Drop `End`.
5. Draw edges: Manual → Get Issue, Webhook → Get Issue, Get Issue → End.

Expected: the issues panel **no longer** shows `"Get Issue" has 2 incoming arrows…`. (The unrelated missing-`ref` errors may still appear; that's fine.)

- [ ] **Step 3: Publish the flow**

Click **Publish**. Fix any unrelated config errors (set the `ref` field, etc.) until publish succeeds.

Expected: the flow publishes without any "incoming arrows" or "no fork upstream" error.

- [ ] **Step 4: (Optional) Fire each trigger and confirm both create instances**

- Hit **Run** → confirm a new instance starts at Get Issue.
- POST to the webhook URL with a matching event → confirm a separate new instance starts at Get Issue.

Each trigger fires an independent instance, as designed.

- [ ] **Step 5: No commit for this task** — verification only.

---

## Self-Review Notes

- **Spec coverage:** All 5 test cases from the spec's "Test cases" section are in Task 1. The single validator change in Task 2 implements the spec's "single change: relax the incoming-edge rule" section. Manual verification in Task 3 covers the "Resulting graph" example.
- **Placeholders:** None — every step contains exact file paths, complete code, and exact commands.
- **Type consistency:** The renamed local `defaultIncomingByTarget` is only used inside the same function scope it was introduced in; no external consumers. Error message uses `sources.length` which equals the old `n`. Test helper types use `WorkflowGraph["nodes"][number]` and `WorkflowGraph["edges"][number]` consistently.
- **Out of scope (confirmed against spec):** No fork-join validator change, no orchestrator change, no UI change, no migration.
