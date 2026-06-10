# Snapshot Workflow Defaults onto New Steps at Drop Time — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user drags a new step onto the flow-editor canvas, copy the workflow's four defaults (provider, model, retry, sandbox) onto the new step as its own values, fixing the bug where the provider was hard-coded to the system default.

**Architecture:** A new step starts with empty config, so "snapshot" is a plain field copy — no merge. A pure helper `applyDefaultsToNewNode` in `flow-graph.ts` writes the workflow defaults onto a node (provider resolves to the workflow default or, failing that, the system default; model/retry/sandbox are copied only when set; retry is shallow-cloned so the node never shares the defaults object). The canvas drop handler calls it when building a step node.

**Tech Stack:** TypeScript, React, `@journeyman/core` types, vitest + `node:assert/strict` for tests.

**Spec:** [docs/superpowers/specs/2026-06-10-snapshot-workflow-defaults-on-drop-design.md](../specs/2026-06-10-snapshot-workflow-defaults-on-drop-design.md)

---

## File Structure

- **Modify** `packages/flow-editor/src/state/flow-graph.ts` — add the `applyDefaultsToNewNode` helper alongside `newStepNode`.
- **Create** `packages/flow-editor/src/state/flow-graph.test.ts` — unit tests for the helper.
- **Modify** `packages/flow-editor/package.json` — add a `test` script so vitest runs (the package currently has none).
- **Modify** `packages/flow-editor/src/canvas/Canvas.tsx` — call the helper in the drop handler's step branch.

---

## Task 1: `applyDefaultsToNewNode` helper (TDD)

**Files:**
- Modify: `packages/flow-editor/src/state/flow-graph.ts:1` (imports) and append helper after `newStepNode` (`packages/flow-editor/src/state/flow-graph.ts:31`)
- Create: `packages/flow-editor/src/state/flow-graph.test.ts`
- Modify: `packages/flow-editor/package.json:11-13` (scripts block)

- [ ] **Step 1: Add a `test` script to the package so vitest runs**

Edit `packages/flow-editor/package.json`. The current scripts block is:

```json
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
```

Replace it with:

```json
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
```

- [ ] **Step 2: Write the failing test**

Create `packages/flow-editor/src/state/flow-graph.test.ts`:

```typescript
import assert from "node:assert/strict";
import { test } from "vitest";
import type { WorkflowDefaults, WorkflowNode } from "@journeyman/core";
import { applyDefaultsToNewNode } from "./flow-graph.ts";

const baseNode: WorkflowNode = {
  id: "step_abc123",
  type: "step",
  stepType: "custom-ai",
  displayName: "Custom AI",
  config: {},
};

test("applyDefaultsToNewNode: copies all four defaults onto the node", () => {
  const defaults: WorkflowDefaults = {
    executorConfig: { "coding-cli": { provider: "opencode" } },
    defaultModel: "claude-opus-4-8",
    retry: { enabled: true, maxAttempts: 3 },
    sandboxId: "sbx-1",
  };
  const node = applyDefaultsToNewNode(baseNode, defaults, "coding-cli", "claude");
  assert.deepEqual(node.executorConfig, { provider: "opencode" });
  assert.equal(node.model, "claude-opus-4-8");
  assert.deepEqual(node.retry, { enabled: true, maxAttempts: 3 });
  assert.equal(node.sandboxId, "sbx-1");
});

test("applyDefaultsToNewNode: no defaults → provider falls back to system, rest unset", () => {
  const node = applyDefaultsToNewNode(baseNode, undefined, "coding-cli", "claude");
  assert.deepEqual(node.executorConfig, { provider: "claude" });
  assert.equal(node.model, undefined);
  assert.equal(node.retry, undefined);
  assert.equal(node.sandboxId, undefined);
});

test("applyDefaultsToNewNode: partial defaults → only set fields copied, provider still resolves", () => {
  const defaults: WorkflowDefaults = { defaultModel: "claude-sonnet-4-6" };
  const node = applyDefaultsToNewNode(baseNode, defaults, "coding-cli", "claude");
  assert.equal(node.model, "claude-sonnet-4-6");
  assert.deepEqual(node.executorConfig, { provider: "claude" });
  assert.equal(node.retry, undefined);
  assert.equal(node.sandboxId, undefined);
});

test("applyDefaultsToNewNode: no workflow provider and no system provider → executorConfig undefined", () => {
  const node = applyDefaultsToNewNode(baseNode, {}, "coding-cli", undefined);
  assert.equal(node.executorConfig, undefined);
});

test("applyDefaultsToNewNode: retry is a fresh copy, not shared with defaults", () => {
  const defaults: WorkflowDefaults = { retry: { enabled: true, maxAttempts: 2 } };
  const node = applyDefaultsToNewNode(baseNode, defaults, "coding-cli", "claude");
  assert.notEqual(node.retry, defaults.retry); // different object reference
  assert.deepEqual(node.retry, defaults.retry); // same values
});

test("applyDefaultsToNewNode: does not mutate the input node", () => {
  const input: WorkflowNode = { ...baseNode };
  applyDefaultsToNewNode(input, { defaultModel: "x" }, "coding-cli", "claude");
  assert.equal(input.model, undefined);
  assert.equal(input.executorConfig, undefined);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/flow-editor && npx vitest run src/state/flow-graph.test.ts`
Expected: FAIL — `applyDefaultsToNewNode` is not exported from `./flow-graph.ts` (import/compile error).

- [ ] **Step 4: Implement the helper**

In `packages/flow-editor/src/state/flow-graph.ts`, update the import on line 1 to add the `ExecutorKind` and `WorkflowDefaults` types:

```typescript
import {
  WORKFLOW_SCHEMA_VERSION,
  isTriggerNode,
  type ExecutorKind,
  type WorkflowDefaults,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from "@journeyman/core";
```

Then add this function immediately after `newStepNode` (after line 31, before `newEdge`):

```typescript
/**
 * Snapshot the workflow's defaults onto a freshly-created step node.
 *
 * A new step starts with empty config, so this is a plain copy — not a merge.
 * Each field is written only when a value exists, so the node is never
 * clobbered with `undefined`. The copied values become the node's own: later
 * edits to the workflow defaults do NOT affect this node.
 *
 * `provider` always resolves to the workflow default for this executor kind
 * when set, otherwise the system default (`systemProvider`). `retry` is
 * shallow-cloned so the node never shares the defaults object.
 */
export function applyDefaultsToNewNode(
  node: WorkflowNode,
  defaults: WorkflowDefaults | undefined,
  executorKind: ExecutorKind,
  systemProvider: string | undefined,
): WorkflowNode {
  const next: WorkflowNode = { ...node };

  const provider = defaults?.executorConfig?.[executorKind]?.provider ?? systemProvider;
  next.executorConfig = provider ? { provider } : undefined;

  if (defaults?.defaultModel !== undefined) next.model = defaults.defaultModel;
  if (defaults?.retry !== undefined) next.retry = { ...defaults.retry };
  if (defaults?.sandboxId !== undefined) next.sandboxId = defaults.sandboxId;

  return next;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/flow-editor && npx vitest run src/state/flow-graph.test.ts`
Expected: PASS — 6 tests passing.

- [ ] **Step 6: Typecheck the package**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/flow-editor/src/state/flow-graph.ts packages/flow-editor/src/state/flow-graph.test.ts packages/flow-editor/package.json
git commit -m "feat(flow-editor): add applyDefaultsToNewNode helper for snapshotting workflow defaults"
```

---

## Task 2: Wire the helper into the canvas drop handler

**Files:**
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx:378-396` (step branch of `handleDrop`)

This task has no new unit test: `handleDrop` is a React DOM drag-event callback (uses `screenToFlowPosition`, `dataTransfer`, refs) that is impractical to unit-test in isolation. The copied-field logic is fully covered by Task 1's tests. Verification here is typecheck + manual canvas check.

- [ ] **Step 1: Confirm the current step branch**

Read `packages/flow-editor/src/canvas/Canvas.tsx:378-396`. It currently reads:

```typescript
      const base = newStepNode({
        stepType: runtimeStepType,
        displayName: def?.label ?? runtimeStepType,
        position,
      });
      newNode = def
        ? {
            ...base,
            config: { ...(def.defaultConfig as Record<string, unknown>) },
            executorConfig: (() => {
              const provider = defaultProviderFor(def.executor.kind);
              return provider ? { provider } : undefined;
            })(),
            secretBindings: (def.slots ?? []).reduce<Record<string, { mode: "auto" }>>(
              (acc, slot) => { acc[slot.name] = { mode: "auto" }; return acc; },
              {},
            ),
          }
        : base;
```

- [ ] **Step 2: Replace it to call the helper**

Replace the block above with the following. This removes the inline `executorConfig` IIFE and routes the node through `applyDefaultsToNewNode`, passing the workflow's defaults (`flowRef.current.defaults`), the step's executor kind, and the existing system-default provider as the fallback:

```typescript
      const base = newStepNode({
        stepType: runtimeStepType,
        displayName: def?.label ?? runtimeStepType,
        position,
      });
      newNode = def
        ? applyDefaultsToNewNode(
            {
              ...base,
              config: { ...(def.defaultConfig as Record<string, unknown>) },
              secretBindings: (def.slots ?? []).reduce<Record<string, { mode: "auto" }>>(
                (acc, slot) => { acc[slot.name] = { mode: "auto" }; return acc; },
                {},
              ),
            },
            flowRef.current.defaults,
            def.executor.kind,
            defaultProviderFor(def.executor.kind),
          )
        : base;
```

- [ ] **Step 3: Add the helper to the import from the state module**

Find the existing import of `newStepNode` near the top of `packages/flow-editor/src/canvas/Canvas.tsx` (search for `newStepNode`). Add `applyDefaultsToNewNode` to the same import statement. For example, if the line is:

```typescript
import { newStepNode, newEdge } from "../state/flow-graph.ts";
```

change it to:

```typescript
import { applyDefaultsToNewNode, newStepNode, newEdge } from "../state/flow-graph.ts";
```

(Match the exact symbols already imported on that line — only add `applyDefaultsToNewNode`; do not remove `defaultProviderFor`, which is still used as the fallback argument.)

- [ ] **Step 4: Typecheck the package**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: no errors. (Confirms `flowRef.current.defaults` typecheck-resolves to `WorkflowDefaults | undefined`, matching the helper's parameter.)

- [ ] **Step 5: Run the full flow-editor test suite + import boundaries**

Run: `npm test -w @journeyman/flow-editor && npm run check:boundaries`
Expected: all tests pass; boundary check passes.

- [ ] **Step 6: Manual canvas verification**

In the running web app, with a workflow whose defaults set a non-system provider (e.g. `opencode`), a model, a retry policy, and a sandbox:
1. Drag a new coding-cli step (e.g. Custom AI) onto the canvas.
2. Open its properties panel.
3. Confirm: the provider shows your workflow default (`opencode`), not the system default (`claude`); the model, retry, and sandbox show your chosen defaults as the step's own concrete values (no "From flow defaults" inherited tag).
4. Change a workflow default afterward and confirm the already-dropped step does NOT change.

- [ ] **Step 7: Commit**

```bash
git add packages/flow-editor/src/canvas/Canvas.tsx
git commit -m "fix(flow-editor): snapshot workflow defaults onto newly-dropped steps"
```

---

## Self-Review Notes

- **Spec coverage:** Provider/model/retry/sandbox copy → Task 1 helper + Task 2 wiring. Snapshot independence (later default changes don't affect existing steps) → helper writes concrete fields + shallow-clones retry; verified in Task 1 ("fresh copy") and Task 2 Step 6.4. Provider system-default fallback preserved → Task 1 test 2 + the `systemProvider` argument. "From flow defaults" tag disappearing is the intended consequence → Task 2 Step 6.3.
- **Out of scope honored:** No orchestrator changes; no migration; existing nodes untouched (helper only runs in the drop handler for new nodes).
- **Type consistency:** Helper signature `applyDefaultsToNewNode(node, defaults, executorKind, systemProvider)` is identical in Task 1 (definition + tests) and Task 2 (call site). `def.executor.kind` is `ExecutorKind` (matches `defaultProviderFor`'s existing usage at `Canvas.tsx:388`). `flowRef.current.defaults` is `WorkflowDefaults | undefined` (`WorkflowGraph.defaults`), matching the helper's parameter.
