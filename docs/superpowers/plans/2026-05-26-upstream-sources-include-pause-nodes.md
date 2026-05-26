# Upstream Sources: Include Human-Task and Webhook-Wait — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `useUpstreamSources` expose dominating `human-task` and `webhook-wait` nodes (with their declared outputs + reserved meta keys) so downstream step input pickers and if-else gate condition pickers can reference them.

**Architecture:** Add a small pure helper `pauseNodeSource(node) → UpstreamSource | null` that handles human-task and webhook-wait nodes. Loosen the `n.type !== "step"` filter in `useUpstreamSources` to call the helper for those two types. No engine, schema, or UI changes.

**Tech Stack:** TypeScript, existing `@journeyman/core` types (`WorkflowNode`, `HumanTaskOutputField`, `WebhookWaitOutputField`, `HUMAN_TASK_RESERVED_KEYS`, `WEBHOOK_WAIT_RESERVED_KEYS`, `Shape`), `node:assert` tests run via `npx tsx`.

**Spec:** [docs/superpowers/specs/2026-05-26-upstream-sources-include-pause-nodes-design.md](../specs/2026-05-26-upstream-sources-include-pause-nodes-design.md)

---

## File Map

- **Create** `packages/flow-editor/src/properties-panel/pause-node-source.ts` — pure helper: maps a `human-task` or `webhook-wait` `WorkflowNode` to an `UpstreamSource` with `Outputs` + `System` groups. Returns `null` for any other node type.
- **Create** `packages/flow-editor/src/properties-panel/pause-node-source.test.ts` — unit tests (`node:assert`, `npx tsx`).
- **Modify** `packages/flow-editor/src/properties-panel/use-upstream-sources.ts` — replace the `if (!n || n.type !== "step" || !n.stepType) continue;` early-exit with a branch that calls `pauseNodeSource(n)` for human-task / webhook-wait, then falls through to the existing step-handling code for `type === "step"`.

---

## Task 1: Pure helper — `pauseNodeSource`

**Files:**
- Create: `packages/flow-editor/src/properties-panel/pause-node-source.ts`
- Create: `packages/flow-editor/src/properties-panel/pause-node-source.test.ts`

Returns an `UpstreamSource` (kind `"node"`) for a human-task or webhook-wait `WorkflowNode`. Builds:
- `Outputs` group from `node.config.outputs` (omitted if empty/missing).
- `System` group from `HUMAN_TASK_RESERVED_KEYS` / `WEBHOOK_WAIT_RESERVED_KEYS` (always present).
- Label is `node.displayName ?? ("Human task" | "Webhook wait")`.
- All fields have `scope: "output"` so the resulting refs come out as `${nodeId.output.fieldName}`.

Type mapping for declared outputs: `string|number|boolean → { type }`, `json → { type: "object", fields: {} }`, `date → { type: "string" }`. Reserved keys: `payload → object`, all others → string.

- [ ] **Step 1.1: Write the failing test file**

Create `packages/flow-editor/src/properties-panel/pause-node-source.test.ts`:

```ts
import assert from "node:assert/strict";
import type { WorkflowNode } from "@journeyman/core";
import { pauseNodeSource } from "./pause-node-source.ts";

// Helper to find a group by title.
function group(src: ReturnType<typeof pauseNodeSource>, title: string) {
  assert.ok(src, "expected source");
  const g = src!.groups.find(x => x.title === title);
  assert.ok(g, `expected group ${title}`);
  return g!;
}

// === human-task with declared outputs ===
{
  const node: WorkflowNode = {
    id: "ht1",
    type: "human-task",
    displayName: "Review PR",
    config: {
      outputs: [
        { name: "approved", type: "boolean" },
        { name: "comments", type: "string", description: "Reviewer comments" },
        { name: "score",    type: "number" },
        { name: "meta",     type: "json" },
        { name: "due",      type: "date" },
      ],
    },
  };
  const src = pauseNodeSource(node);
  assert.ok(src);
  assert.equal(src!.id, "ht1");
  assert.equal(src!.label, "Review PR");
  assert.equal(src!.kind, "node");

  const outs = group(src, "Outputs");
  assert.equal(outs.scope, "output");
  assert.deepEqual(outs.fields.map(f => [f.name, f.shape]), [
    ["approved", { type: "boolean" }],
    ["comments", { type: "string" }],
    ["score",    { type: "number" }],
    ["meta",     { type: "object", fields: {} }],
    ["due",      { type: "string" }],
  ]);
  // description preserved when present
  assert.equal(outs.fields.find(f => f.name === "comments")!.description, "Reviewer comments");

  const sys = group(src, "System");
  assert.equal(sys.scope, "output");
  assert.deepEqual(sys.fields.map(f => f.name), ["source", "actor", "resolvedAt", "payload"]);
  assert.deepEqual(sys.fields.find(f => f.name === "payload")!.shape, { type: "object", fields: {} });
  assert.deepEqual(sys.fields.find(f => f.name === "source")!.shape, { type: "string" });
}

// === webhook-wait with one declared output ===
{
  const node: WorkflowNode = {
    id: "ww1",
    type: "webhook-wait",
    config: {
      outputs: [{ name: "pr_number", type: "number" }],
    },
  };
  const src = pauseNodeSource(node);
  assert.ok(src);
  assert.equal(src!.label, "Webhook wait"); // no displayName → default

  const outs = group(src, "Outputs");
  assert.deepEqual(outs.fields.map(f => [f.name, f.shape]), [
    ["pr_number", { type: "number" }],
  ]);

  const sys = group(src, "System");
  assert.deepEqual(sys.fields.map(f => f.name), ["source", "resolvedAt", "webhookEventId", "payload"]);
}

// === human-task with empty/missing outputs → only System group ===
{
  const node: WorkflowNode = { id: "ht2", type: "human-task", config: { outputs: [] } };
  const src = pauseNodeSource(node);
  assert.ok(src);
  assert.equal(src!.groups.length, 1);
  assert.equal(src!.groups[0].title, "System");
}
{
  const node: WorkflowNode = { id: "ht3", type: "human-task" }; // no config at all
  const src = pauseNodeSource(node);
  assert.ok(src);
  assert.equal(src!.groups.length, 1);
  assert.equal(src!.groups[0].title, "System");
}

// === non-pause node returns null ===
{
  const node: WorkflowNode = { id: "s1", type: "step", stepType: "clone-repos" };
  assert.equal(pauseNodeSource(node), null);
}
{
  const node: WorkflowNode = { id: "t1", type: "trigger-manual" };
  assert.equal(pauseNodeSource(node), null);
}

console.log("pause-node-source: ok");
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx tsx packages/flow-editor/src/properties-panel/pause-node-source.test.ts`
Expected: FAIL — `Cannot find module '.../pause-node-source.ts'`.

- [ ] **Step 1.3: Implement the helper**

Create `packages/flow-editor/src/properties-panel/pause-node-source.ts`:

```ts
import type { WorkflowNode, Shape } from "@journeyman/core";
import { HUMAN_TASK_RESERVED_KEYS, WEBHOOK_WAIT_RESERVED_KEYS } from "@journeyman/core";
import type { UpstreamSource, UpstreamField } from "./use-upstream-sources.ts";

type DeclaredFieldType = "string" | "number" | "boolean" | "json" | "date";

interface DeclaredOutput {
  name: string;
  type: DeclaredFieldType;
  description?: string;
}

function shapeForDeclared(t: DeclaredFieldType): Shape {
  if (t === "json") return { type: "object", fields: {} } as Shape;
  if (t === "date") return { type: "string" } as Shape;
  return { type: t } as Shape;
}

function shapeForReserved(name: string): Shape {
  if (name === "payload") return { type: "object", fields: {} } as Shape;
  return { type: "string" } as Shape;
}

/**
 * Build an UpstreamSource for a `human-task` or `webhook-wait` node. Returns
 * null for any other node type. The source always has a `System` group of
 * reserved meta keys; an `Outputs` group is only included when the node
 * declares at least one output field in `config.outputs`.
 */
export function pauseNodeSource(node: WorkflowNode): UpstreamSource | null {
  if (node.type !== "human-task" && node.type !== "webhook-wait") return null;

  const reserved = node.type === "human-task"
    ? HUMAN_TASK_RESERVED_KEYS
    : WEBHOOK_WAIT_RESERVED_KEYS;
  const defaultLabel = node.type === "human-task" ? "Human task" : "Webhook wait";

  const declared = ((node.config ?? {}) as { outputs?: DeclaredOutput[] }).outputs ?? [];

  const groups: UpstreamSource["groups"] = [];
  if (declared.length > 0) {
    groups.push({
      title: "Outputs",
      scope: "output",
      fields: declared.map((d): UpstreamField => ({
        name: d.name,
        description: d.description,
        scope: "output",
        shape: shapeForDeclared(d.type),
      })),
    });
  }
  groups.push({
    title: "System",
    scope: "output",
    fields: reserved.map((name): UpstreamField => ({
      name,
      scope: "output",
      shape: shapeForReserved(name),
    })),
  });

  return {
    kind: "node",
    id: node.id,
    label: node.displayName ?? defaultLabel,
    groups,
  };
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `npx tsx packages/flow-editor/src/properties-panel/pause-node-source.test.ts`
Expected: `pause-node-source: ok`

- [ ] **Step 1.5: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: clean exit.

- [ ] **Step 1.6: Commit**

```bash
git add packages/flow-editor/src/properties-panel/pause-node-source.ts packages/flow-editor/src/properties-panel/pause-node-source.test.ts
git commit -m "feat(flow-editor): add pauseNodeSource helper for human-task/webhook-wait pickers"
```

---

## Task 2: Wire `pauseNodeSource` into `useUpstreamSources`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/use-upstream-sources.ts` (lines ~107-162 — the upstream-iteration loop)

The current loop body skips any node that isn't `type === "step"`. Replace that early-exit with branching: for human-task / webhook-wait, push the result of `pauseNodeSource(n)`; otherwise fall through to the existing step-handling block. Everything else (dominator computation, run-inputs source, slow-warn) stays untouched.

- [ ] **Step 2.1: Add the import**

In `packages/flow-editor/src/properties-panel/use-upstream-sources.ts`, add this import next to the existing imports near the top of the file:

```ts
import { pauseNodeSource } from "./pause-node-source.ts";
```

- [ ] **Step 2.2: Replace the loop body**

Replace the block from `for (const id of upstream) {` through the matching closing `}` of that `for` (currently ending at line ~162, just before `const _ms = performance.now() - _t0;`) with:

```ts
    for (const id of upstream) {
      const n = graph.nodes.find(x => x.id === id);
      if (!n) continue;

      if (n.type === "human-task" || n.type === "webhook-wait") {
        const src = pauseNodeSource(n);
        if (src) sources.push(src);
        continue;
      }

      if (n.type !== "step" || !n.stepType) continue;

      let inputFields: StepCatalogEntry["inputFields"] = {};
      let outputSchema: StepCatalogEntry["outputSchema"] = {};

      if (n.stepType === "custom-ai") {
        const customId = (n.config as { customStepId?: unknown } | undefined)?.customStepId;
        if (typeof customId !== "string" || !customId) continue;
        const def = customStepDefs?.[customId];
        if (!def) continue;
        const shape = customStepToShape(def);
        inputFields = shape.inputFields;
        outputSchema = shape.outputSchema ?? {};
      } else {
        const entry = catalog[n.stepType];
        inputFields = entry?.inputFields ?? {};
        outputSchema = entry?.outputSchema ?? {};
      }

      const groups: UpstreamSource["groups"] = [];
      const inputEntries = Object.entries(inputFields);
      if (inputEntries.length) {
        groups.push({
          title: "Inputs",
          scope: "input",
          fields: inputEntries.map(([name, meta]) => ({
            name,
            description: meta.label,
            scope: "input",
            shape: meta.shape,
          })),
        });
      }
      const outputEntries = Object.entries(outputSchema);
      if (outputEntries.length) {
        groups.push({
          title: "Outputs",
          scope: "output",
          fields: outputEntries.map(([name, s]) => ({
            name,
            description: (s as { description?: string }).description,
            scope: "output",
            shape: s as Shape,
          })),
        });
      }

      sources.push({
        kind: "node",
        id,
        label: n.displayName ?? n.stepType,
        groups,
      });
    }
```

Note: this is the existing loop body verbatim, with the `n.type !== "step"` early-exit split into (a) a pause-node branch above it and (b) the unchanged step check below.

- [ ] **Step 2.3: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: clean exit.

- [ ] **Step 2.4: Boundary check**

Run: `npm run check:boundaries`
Expected: `✓ Layer boundaries clean across all packages.`

- [ ] **Step 2.5: Rerun the helper test (sanity)**

Run: `npx tsx packages/flow-editor/src/properties-panel/pause-node-source.test.ts`
Expected: `pause-node-source: ok` (still — Task 2 didn't touch the helper).

- [ ] **Step 2.6: Commit**

```bash
git add packages/flow-editor/src/properties-panel/use-upstream-sources.ts
git commit -m "feat(flow-editor): include human-task/webhook-wait in upstream picker sources"
```

---

## Task 3: Manual verification in the running app

The package has no React test runner, so manual browser verification is the acceptance gate for the UI behavior.

- [ ] **Step 3.1: Start infra + services**

```bash
npm run infra:up
npm run migrate
npm run start:api-server      # in one terminal
npm run start:worker          # in another
npm run dev:web               # in another
```

- [ ] **Step 3.2: Human-task → step**

In the browser:
1. New workflow with a manual trigger.
2. Add a `human-task` node downstream. Open its config and declare two outputs: `approved: boolean`, `comments: string`.
3. Add a step downstream of the human-task (e.g. any built-in step with at least one bindable input).
4. Open the step's input properties panel; click `{x}` on any input.
5. Confirm the picker source list shows the human-task (label = its displayName).
6. Confirm the human-task source has two groups: `Outputs` (with `approved`, `comments`) and `System` (with `source`, `actor`, `resolvedAt`, `payload`).
7. Pick `approved`; confirm the ref bound to the input is `${<humanTaskId>.output.approved}`.

- [ ] **Step 3.3: Webhook-wait → step**

1. Add a webhook trigger + webhook-wait node mid-flow (using whatever registered webhook is available).
2. Declare one webhook-wait output: `pr_number: number`.
3. Add a downstream step; open its input picker.
4. Confirm the webhook-wait source appears with `Outputs` (`pr_number`) and `System` (`source`, `resolvedAt`, `webhookEventId`, `payload`).

- [ ] **Step 3.4: If-else gate downstream of a pause node**

1. After the human-task from Step 3.2, add an if-else gate.
2. Open a conditional edge leaving the gate; in the condition row, click the LHS `{x}` button.
3. Confirm the picker shows the human-task as a source with the same `Outputs` + `System` groups.
4. Pick `approved`; confirm the operator dropdown + RHS render correctly (boolean → `true/false` dropdown). Save and verify the JSON renders as `{ "==": [{ "var": "<id>.output.approved" }, true] }` or similar.

- [ ] **Step 3.5: Empty-outputs human-task**

1. Add a second human-task with NO declared outputs.
2. Add a step downstream; open its picker.
3. Confirm the human-task source still appears, with only the `System` group (no `Outputs` group).

- [ ] **Step 3.6: Final commit (if any tweaks needed)**

If Steps 3.1–3.5 surfaced tweaks (label copy, ordering, etc.), apply them and commit. Otherwise skip.

---

## Self-Review Notes

- **Spec coverage:**
  - "Files touched" → Task 1 creates helper + tests; Task 2 modifies the hook. ✓
  - "Source-building rules — Group 1 / Group 2" → encoded in `pauseNodeSource`, asserted by Task 1.1 tests. ✓
  - Type mapping table (`string|number|boolean|json|date`) → asserted via the multi-type human-task fixture in Task 1.1. ✓
  - "Reachability" (no extra filter needed) → falls out of the dominator computation already in the hook, plus Task 2.2's branch only kicks in for human-task/webhook-wait. ✓
  - Edge cases: no declared outputs (covered by `ht2`/`ht3` cases), config missing entirely (`ht3`), display-name default ("Webhook wait" via `ww1`), display-name override (`Review PR` via `ht1`). ✓
  - Testing — unit (Task 1.1) + manual (Task 3). ✓
- **Placeholder scan:** No TBDs, no hand-waved "handle edge cases" — every step contains the full code or the exact command.
- **Type consistency:** `pauseNodeSource(node) → UpstreamSource | null` — used identically in Task 2.2 (`const src = pauseNodeSource(n); if (src) sources.push(src);`). `UpstreamSource` / `UpstreamField` types imported from `./use-upstream-sources.ts` in both directions — no circular-import concern because `use-upstream-sources.ts` doesn't depend on `pause-node-source.ts` types at module load time (it imports the function only).
