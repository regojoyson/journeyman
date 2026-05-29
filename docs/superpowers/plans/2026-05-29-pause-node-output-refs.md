# Pause-node Output Refs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a downstream step reference an output of a Webhook Wait / Human Task node without the validator failing with "is not a step".

**Architecture:** Add one shared function in `@journeyman/core` that returns a pause node's output schema (reserved meta keys + declared `config.outputs`, each with a Shape). Teach the orchestrator's ref-shape resolver to use it for pause-node sources, and refactor the flow-editor's picker to consume the same function so the editor and the validator can never disagree.

**Tech Stack:** TypeScript, npm workspaces monorepo. Tests are plain files run with `npx tsx <file>.test.ts` using `node:assert/strict` and a final `console.log("<name>: ok")`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/utils/pause-node-output.ts` (new) | Pure function `pauseNodeOutputSchema(node)` → `OutputSchema \| null`. Single source of truth for a pause node's output shapes. |
| `packages/core/src/utils/pause-node-output.test.ts` (new) | Unit tests for the helper. |
| `packages/core/src/index.ts` (modify) | Export the new helper. |
| `packages/orchestrator/src/flow-json/validate-ref-shape.ts` (modify) | Resolve refs whose source is a pause node against the helper's schema, instead of erroring. |
| `packages/orchestrator/src/flow-json/validate-ref-shape.pause-node.test.ts` (new) | Resolver tests + regression for the reported bug. |
| `packages/flow-editor/src/properties-panel/pause-node-source.ts` (modify) | Reuse the core helper for field shapes instead of its private copies. |

---

## Task 1: Core helper `pauseNodeOutputSchema`

**Files:**
- Create: `packages/core/src/utils/pause-node-output.ts`
- Test: `packages/core/src/utils/pause-node-output.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/utils/pause-node-output.test.ts`:

```ts
import assert from "node:assert/strict";
import type { WorkflowNode } from "../types/flow.types.ts";
import { pauseNodeOutputSchema } from "./pause-node-output.ts";

// Webhook Wait: reserved keys + one declared output.
const webhookNode = {
  id: "ww_1",
  type: "webhook-wait",
  config: {
    outputs: [{ name: "issueNumber", type: "number" }],
  },
} as unknown as WorkflowNode;

const ww = pauseNodeOutputSchema(webhookNode);
assert.ok(ww, "webhook-wait should produce a schema");
assert.deepEqual(ww!.payload, { type: "object", fields: {} }, "payload is an object");
assert.deepEqual(ww!.resolvedAt, { type: "string" });
assert.deepEqual(ww!.source, { type: "string" });
assert.deepEqual(ww!.webhookEventId, { type: "string" });
assert.deepEqual(ww!.issueNumber, { type: "number" }, "declared number output");

// Human Task: reserved set has `actor`, not `webhookEventId`.
const humanNode = {
  id: "ht_1",
  type: "human-task",
  config: { outputs: [{ name: "approved", type: "boolean" }] },
} as unknown as WorkflowNode;

const ht = pauseNodeOutputSchema(humanNode);
assert.ok(ht, "human-task should produce a schema");
assert.deepEqual(ht!.actor, { type: "string" });
assert.equal(ht!.webhookEventId, undefined, "human-task has no webhookEventId");
assert.deepEqual(ht!.approved, { type: "boolean" });

// json/date declared outputs map correctly.
const jsonNode = {
  id: "ww_2",
  type: "webhook-wait",
  config: { outputs: [{ name: "blob", type: "json" }, { name: "when", type: "date" }] },
} as unknown as WorkflowNode;
const j = pauseNodeOutputSchema(jsonNode);
assert.deepEqual(j!.blob, { type: "object", fields: {} }, "json output is an object");
assert.deepEqual(j!.when, { type: "string" }, "date output is a string");

// Non-pause node → null.
const stepNode = { id: "s_1", type: "step", stepType: "custom-ai", config: {} } as unknown as WorkflowNode;
assert.equal(pauseNodeOutputSchema(stepNode), null, "non-pause node returns null");

// Missing config / outputs → reserved keys only, no throw.
const bare = { id: "ww_3", type: "webhook-wait" } as unknown as WorkflowNode;
const b = pauseNodeOutputSchema(bare);
assert.ok(b, "bare pause node still returns reserved keys");
assert.deepEqual(b!.payload, { type: "object", fields: {} });

console.log("pause-node-output: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/core/src/utils/pause-node-output.test.ts`
Expected: FAIL — cannot find module `./pause-node-output.ts` (file does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/utils/pause-node-output.ts`:

```ts
import type { WorkflowNode } from "../types/flow.types.ts";
import type { OutputSchema, Shape } from "../types/shape.types.ts";
import { WEBHOOK_WAIT_RESERVED_KEYS } from "../types/webhook-wait.types.ts";
import { HUMAN_TASK_RESERVED_KEYS } from "../types/human-task.types.ts";

type DeclaredFieldType = "string" | "number" | "boolean" | "json" | "date";

interface DeclaredOutput {
  name: string;
  type: DeclaredFieldType;
  description?: string;
}

function shapeForDeclared(t: DeclaredFieldType): Shape {
  if (t === "json") return { type: "object", fields: {} };
  if (t === "date") return { type: "string" };
  return { type: t };
}

function shapeForReserved(name: string): Shape {
  if (name === "payload") return { type: "object", fields: {} };
  return { type: "string" };
}

/**
 * The output schema a `webhook-wait` / `human-task` node exposes to downstream
 * refs: the user-declared `config.outputs` plus the always-present reserved
 * meta keys. Reserved keys are applied last so they win on a name clash, mirroring
 * the runtime artifact (`{ ...declared, source, resolvedAt, ... }`). Returns
 * `null` for any non-pause node.
 */
export function pauseNodeOutputSchema(node: WorkflowNode): OutputSchema | null {
  if (node.type !== "webhook-wait" && node.type !== "human-task") return null;

  const reserved =
    node.type === "webhook-wait" ? WEBHOOK_WAIT_RESERVED_KEYS : HUMAN_TASK_RESERVED_KEYS;
  const declared = ((node.config ?? {}) as { outputs?: DeclaredOutput[] }).outputs ?? [];

  const schema: OutputSchema = {};
  for (const d of declared) {
    if (d?.name) schema[d.name] = shapeForDeclared(d.type);
  }
  for (const name of reserved) {
    schema[name] = shapeForReserved(name);
  }
  return schema;
}
```

- [ ] **Step 4: Export from the core barrel**

In `packages/core/src/index.ts`, find the existing line:

```ts
export { getStartWorkflowInputs } from "./utils/start-node.ts";
```

Add immediately after it:

```ts
export { pauseNodeOutputSchema } from "./utils/pause-node-output.ts";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx packages/core/src/utils/pause-node-output.test.ts`
Expected: PASS — prints `pause-node-output: ok`.

- [ ] **Step 6: Typecheck core**

Run: `npm run typecheck --workspace @journeyman/core`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/utils/pause-node-output.ts packages/core/src/utils/pause-node-output.test.ts packages/core/src/index.ts
git commit -m "feat(core): pauseNodeOutputSchema helper for pause-node outputs"
```

---

## Task 2: Resolve pause-node refs in the validator

**Files:**
- Modify: `packages/orchestrator/src/flow-json/validate-ref-shape.ts:59-61`
- Test: `packages/orchestrator/src/flow-json/validate-ref-shape.pause-node.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/flow-json/validate-ref-shape.pause-node.test.ts`:

```ts
import assert from "node:assert/strict";
import type { WorkflowGraph } from "@journeyman/core";
import { resolveRefShape, type CatalogShapeEntry } from "./validate-ref-shape.ts";

// A flow with a webhook-wait node that declares one output (issueNumber).
const flow = {
  schemaVersion: 2,
  nodes: [
    {
      id: "webhook-wait_pbfs1v",
      type: "webhook-wait",
      displayName: "Webhook Wait",
      config: { outputs: [{ name: "issueNumber", type: "number" }] },
    },
  ],
  edges: [],
} as unknown as WorkflowGraph;

const catalog = new Map<string, CatalogShapeEntry>();

// Reserved meta key resolves (this is the exact reported bug: output.resolvedAt).
const resolvedAt = resolveRefShape(flow, "webhook-wait_pbfs1v.output.resolvedAt", catalog);
assert.equal(resolvedAt.ok, true, `output.resolvedAt should resolve, got: ${resolvedAt.error}`);
assert.deepEqual(resolvedAt.shape, { type: "string" });

// payload resolves to an object.
const payload = resolveRefShape(flow, "webhook-wait_pbfs1v.output.payload", catalog);
assert.equal(payload.ok, true, `output.payload should resolve, got: ${payload.error}`);
assert.deepEqual(payload.shape, { type: "object", fields: {} });

// Declared output resolves with its declared type.
const declared = resolveRefShape(flow, "webhook-wait_pbfs1v.output.issueNumber", catalog);
assert.equal(declared.ok, true, `output.issueNumber should resolve, got: ${declared.error}`);
assert.deepEqual(declared.shape, { type: "number" });

// Unknown output name errors clearly (catches typos).
const bogus = resolveRefShape(flow, "webhook-wait_pbfs1v.output.resolvedAtt", catalog);
assert.equal(bogus.ok, false, "unknown output name should error");
assert.match(bogus.error ?? "", /not declared/, `expected 'not declared' error, got: ${bogus.error}`);

// We no longer emit the old "is not a step" error for pause-node sources.
assert.ok(!/is not a step/.test(bogus.error ?? ""), "should not say 'is not a step'");

console.log("validate-ref-shape.pause-node: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/orchestrator/src/flow-json/validate-ref-shape.pause-node.test.ts`
Expected: FAIL — the first assertion fails because `resolveRefShape` returns `{ ok: false, error: "Node 'Webhook Wait' (webhook-wait_pbfs1v) is not a step" }`.

- [ ] **Step 3: Add the core import**

In `packages/orchestrator/src/flow-json/validate-ref-shape.ts`, find line 2:

```ts
import { resolveShape, shapeAtPath, shapesCompatible, getStartWorkflowInputs, workflowInputDefShape, workflowAttributeDefShape } from "@journeyman/core";
```

Replace it with (adds `pauseNodeOutputSchema`):

```ts
import { resolveShape, shapeAtPath, shapesCompatible, getStartWorkflowInputs, workflowInputDefShape, workflowAttributeDefShape, pauseNodeOutputSchema } from "@journeyman/core";
```

- [ ] **Step 4: Add the pause-node branch**

In the same file, find lines 59-61:

```ts
  const node = flow.nodes.find(n => n.id === parsed.source);
  if (!node) return { ok: false, error: `Node ${labelNode(undefined, parsed.source)} not found` };
  if (node.type !== "step" || !node.stepType) return { ok: false, error: `Node ${labelNode(node, parsed.source)} is not a step` };
```

Replace them with:

```ts
  const node = flow.nodes.find(n => n.id === parsed.source);
  if (!node) return { ok: false, error: `Node ${labelNode(undefined, parsed.source)} not found` };

  // Pause nodes (webhook-wait / human-task) produce outputs too: reserved meta
  // keys + declared config.outputs. Resolve refs against that schema instead of
  // rejecting them as "not a step".
  const pauseSchema = pauseNodeOutputSchema(node);
  if (pauseSchema) {
    if (parsed.scope !== "output") {
      return { ok: false, error: `Node ${labelNode(node, parsed.source)} only exposes outputs (use output.<field>)` };
    }
    const pauseRoot = pauseSchema[path[0]];
    if (!pauseRoot) {
      return { ok: false, error: `Field 'output.${path[0]}' not declared on ${labelNode(node, parsed.source)}` };
    }
    const pauseLeaf = shapeAtPath(pauseRoot, path.slice(1));
    return pauseLeaf ? { ok: true, shape: pauseLeaf } : { ok: false, error: `Path not found: ${ref}` };
  }

  if (node.type !== "step" || !node.stepType) return { ok: false, error: `Node ${labelNode(node, parsed.source)} is not a step` };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx packages/orchestrator/src/flow-json/validate-ref-shape.pause-node.test.ts`
Expected: PASS — prints `validate-ref-shape.pause-node: ok`.

- [ ] **Step 6: Run the existing resolver test (no regression)**

Run: `npx tsx packages/orchestrator/src/flow-json/validate-ref-shape.attribute.test.ts`
Expected: PASS — prints `validate-ref-shape.attribute: ok`.

- [ ] **Step 7: Typecheck orchestrator**

Run: `npm run typecheck --workspace @journeyman/orchestrator`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/orchestrator/src/flow-json/validate-ref-shape.ts packages/orchestrator/src/flow-json/validate-ref-shape.pause-node.test.ts
git commit -m "fix(orchestrator): resolve pause-node output refs in validate-ref-shape"
```

---

## Task 3: Editor picker reuses the core helper

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/pause-node-source.ts`
- Test: `packages/flow-editor/src/properties-panel/pause-node-source.test.ts` (new)

- [ ] **Step 1: Write the test (current behavior, locked in)**

Create `packages/flow-editor/src/properties-panel/pause-node-source.test.ts`:

```ts
import assert from "node:assert/strict";
import type { WorkflowNode } from "@journeyman/core";
import { pauseNodeSource } from "./pause-node-source.ts";

// Webhook-wait with one declared output → "Outputs" group + "System" group.
const node = {
  id: "ww_1",
  type: "webhook-wait",
  displayName: "Webhook Wait",
  config: { outputs: [{ name: "issueNumber", type: "number", description: "the issue #" }] },
} as unknown as WorkflowNode;

const src = pauseNodeSource(node);
assert.ok(src, "should build a source");
assert.equal(src!.id, "ww_1");
assert.equal(src!.label, "Webhook Wait");

const titles = src!.groups.map(g => g.title);
assert.deepEqual(titles, ["Outputs", "System"], `expected Outputs then System, got ${titles}`);

const outputs = src!.groups.find(g => g.title === "Outputs")!;
assert.equal(outputs.fields.length, 1);
assert.deepEqual(outputs.fields[0], {
  name: "issueNumber",
  description: "the issue #",
  scope: "output",
  shape: { type: "number" },
});

const system = src!.groups.find(g => g.title === "System")!;
const systemNames = system.fields.map(f => f.name);
assert.deepEqual(systemNames, ["source", "resolvedAt", "webhookEventId", "payload"]);
assert.deepEqual(system.fields.find(f => f.name === "payload")!.shape, { type: "object", fields: {} });

// No declared outputs → only the System group.
const bare = { id: "ww_2", type: "webhook-wait", config: {} } as unknown as WorkflowNode;
const bareSrc = pauseNodeSource(bare);
assert.deepEqual(bareSrc!.groups.map(g => g.title), ["System"]);

// Non-pause node → null.
const step = { id: "s_1", type: "step", stepType: "custom-ai", config: {} } as unknown as WorkflowNode;
assert.equal(pauseNodeSource(step), null);

console.log("pause-node-source: ok");
```

- [ ] **Step 2: Run the test against the current implementation**

Run: `npx tsx packages/flow-editor/src/properties-panel/pause-node-source.test.ts`
Expected: PASS — the current implementation already produces exactly this. (This locks behavior before the refactor.)

- [ ] **Step 3: Refactor `pause-node-source.ts` to use the core helper**

Replace the entire contents of `packages/flow-editor/src/properties-panel/pause-node-source.ts` with:

```ts
import type { WorkflowNode } from "@journeyman/core";
import { HUMAN_TASK_RESERVED_KEYS, WEBHOOK_WAIT_RESERVED_KEYS, pauseNodeOutputSchema } from "@journeyman/core";
import type { UpstreamSource, UpstreamField } from "./use-upstream-sources.ts";

type DeclaredFieldType = "string" | "number" | "boolean" | "json" | "date";

interface DeclaredOutput {
  name: string;
  type: DeclaredFieldType;
  description?: string;
}

/**
 * Build an UpstreamSource for a `human-task` or `webhook-wait` node. Returns
 * null for any other node type. Field shapes come from the shared core helper
 * `pauseNodeOutputSchema` so the picker and the flow validator never disagree.
 * The source always has a `System` group of reserved meta keys; an `Outputs`
 * group is only included when the node declares at least one output field.
 */
export function pauseNodeSource(node: WorkflowNode): UpstreamSource | null {
  const schema = pauseNodeOutputSchema(node);
  if (!schema) return null;

  const reserved =
    node.type === "human-task" ? HUMAN_TASK_RESERVED_KEYS : WEBHOOK_WAIT_RESERVED_KEYS;
  const defaultLabel = node.type === "human-task" ? "Human task" : "Webhook wait";
  const declared = ((node.config ?? {}) as { outputs?: DeclaredOutput[] }).outputs ?? [];

  const groups: UpstreamSource["groups"] = [];

  const declaredFields = declared
    .filter((d) => d?.name)
    .map((d): UpstreamField => ({
      name: d.name,
      description: d.description,
      scope: "output",
      shape: schema[d.name],
    }));
  if (declaredFields.length > 0) {
    groups.push({ title: "Outputs", scope: "output", fields: declaredFields });
  }

  groups.push({
    title: "System",
    scope: "output",
    fields: reserved.map((name): UpstreamField => ({
      name,
      scope: "output",
      shape: schema[name],
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

- [ ] **Step 4: Run the test to verify behavior is unchanged**

Run: `npx tsx packages/flow-editor/src/properties-panel/pause-node-source.test.ts`
Expected: PASS — prints `pause-node-source: ok` (same output as Step 2).

- [ ] **Step 5: Typecheck flow-editor**

Run: `npm run typecheck --workspace @journeyman/flow-editor`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/flow-editor/src/properties-panel/pause-node-source.ts packages/flow-editor/src/properties-panel/pause-node-source.test.ts
git commit -m "refactor(flow-editor): pause-node picker reuses core pauseNodeOutputSchema"
```

---

## Task 4: Full check + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole-repo check**

Run: `npm run check`
Expected: typecheck passes for all workspaces and import-boundary check passes (orchestrator and flow-editor importing from `@journeyman/core` is allowed).

- [ ] **Step 2: Re-run all three new/affected tests**

Run:
```bash
npx tsx packages/core/src/utils/pause-node-output.test.ts
npx tsx packages/orchestrator/src/flow-json/validate-ref-shape.pause-node.test.ts
npx tsx packages/flow-editor/src/properties-panel/pause-node-source.test.ts
npx tsx packages/orchestrator/src/flow-json/validate-ref-shape.attribute.test.ts
```
Expected: each prints its `... : ok` line.

- [ ] **Step 3: Confirm the original failing workflow now publishes**

Using the workflow from the bug report (a step whose `payload` input binds to `webhook-wait_pbfs1v.output.resolvedAt`), publish it. Expected: no more `Node 'Webhook Wait' (webhook-wait_pbfs1v) is not a step` error.

---

## Self-Review

**Spec coverage:**
- Spec §Design.1 (core `pauseNodeOutputSchema`) → Task 1. ✅
- Spec §Design.2 (fix `resolveRefShape`) → Task 2. ✅
- Spec §Design.3 (editor reuse) → Task 3. ✅
- Spec §Testing (core / resolver / editor) → Tasks 1, 2, 3 tests + Task 4. ✅
- Spec §Acceptance (reserved + declared resolve, unknown errors, editor/converter agree) → covered by Task 2 + Task 3 tests and Task 4 Step 3. ✅
- Spec §Deferred (Problem 1) → intentionally out of scope; not in this plan. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; every run step shows the exact command and expected output. ✅

**Type consistency:** `pauseNodeOutputSchema(node): OutputSchema | null` is defined identically in Task 1 and consumed with the same signature in Tasks 2 and 3. `OutputSchema = Record<string, Shape>` matches `pauseSchema[path[0]]` usage (a `Shape`). Reserved-key shapes (`payload` → `{type:"object",fields:{}}`, others → `{type:"string"}`) are identical across the helper, the resolver test, and the editor test. ✅
