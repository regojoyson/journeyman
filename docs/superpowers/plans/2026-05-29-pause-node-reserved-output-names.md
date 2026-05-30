# Pause-node Reserved Output Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch bad pause-node output names (reserved / duplicate / invalid) early — inline in the editor and at the publish gate — instead of crashing late at flow conversion.

**Architecture:** One pure checker in `@journeyman/core` (`validatePauseNodeOutputNames`) is the single source of truth. The editor's publish gate (`isValidPhase4Graph`) and the two pause-node editors consume it for blocking errors and inline notes; the orchestrator converter stops inlining its reserved-key arrays and uses the core constants.

**Tech Stack:** TypeScript, npm workspaces monorepo. Logic tests run with `npx tsx <file>.test.ts` (`node:assert/strict` + final `console.log("<name>: ok")`). React editor changes are verified by the final `npm run check` (no UI test runner in this repo).

> **Execution preferences (this round):** Do **NOT** run `git commit` in any task. Do **NOT** run per-task `npm run typecheck`. Run the full `npm run check` once, in the final task only. Individual `npx tsx` test runs are still expected (they are verification, not commits).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/utils/pause-node-output-names.ts` (new) | `validatePauseNodeOutputNames(node)` + `PauseOutputNameProblem` / `PauseOutputNameReason` types. Single source of truth. |
| `packages/core/src/utils/pause-node-output-names.test.ts` (new) | Unit tests for the checker. |
| `packages/core/src/index.ts` (modify) | Export the new function + types. |
| `packages/flow-editor/src/state/validation.ts` (modify) | Publish-gate errors for bad output names. |
| `packages/flow-editor/src/state/validation.pause-output-names.test.ts` (new) | Test the publish gate flags a reserved output. |
| `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx` (modify) | Inline per-field error under each output name. |
| `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx` (modify) | Inline per-field error (human-task outputs). |
| `packages/orchestrator/src/flow-json/conductor-converter.ts` (modify) | Use core reserved-key constants instead of inlined arrays. |

---

## Task 1: Core checker `validatePauseNodeOutputNames`

**Files:**
- Create: `packages/core/src/utils/pause-node-output-names.ts`
- Test: `packages/core/src/utils/pause-node-output-names.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/utils/pause-node-output-names.test.ts`:

```ts
import assert from "node:assert/strict";
import type { WorkflowNode } from "../types/flow.types.ts";
import { validatePauseNodeOutputNames } from "./pause-node-output-names.ts";

// Clean webhook-wait → no problems.
const clean = {
  id: "ww_ok",
  type: "webhook-wait",
  config: { outputs: [{ name: "issueNumber", type: "number" }] },
} as unknown as WorkflowNode;
assert.deepEqual(validatePauseNodeOutputNames(clean), [], "clean outputs → no problems");

// Reserved name (webhook-wait): payload.
const reserved = {
  id: "ww_r",
  type: "webhook-wait",
  config: { outputs: [{ name: "payload", type: "json" }] },
} as unknown as WorkflowNode;
const rp = validatePauseNodeOutputNames(reserved);
assert.equal(rp.length, 1);
assert.equal(rp[0].reason, "reserved");
assert.equal(rp[0].index, 0);
assert.equal(rp[0].name, "payload");
assert.match(rp[0].message, /reserved/);

// Reserved name specific to human-task: actor.
const human = {
  id: "ht_r",
  type: "human-task",
  config: { outputs: [{ name: "actor", type: "string" }] },
} as unknown as WorkflowNode;
const hp = validatePauseNodeOutputNames(human);
assert.equal(hp.length, 1);
assert.equal(hp[0].reason, "reserved", "actor is reserved for human-task");

// `actor` is NOT reserved for webhook-wait → allowed.
const wwActor = {
  id: "ww_a",
  type: "webhook-wait",
  config: { outputs: [{ name: "actor", type: "string" }] },
} as unknown as WorkflowNode;
assert.deepEqual(validatePauseNodeOutputNames(wwActor), [], "actor allowed on webhook-wait");

// Duplicate names.
const dup = {
  id: "ww_d",
  type: "webhook-wait",
  config: { outputs: [{ name: "foo", type: "string" }, { name: "foo", type: "number" }] },
} as unknown as WorkflowNode;
const dp = validatePauseNodeOutputNames(dup);
assert.equal(dp.length, 1);
assert.equal(dp[0].reason, "duplicate");
assert.equal(dp[0].index, 1, "second occurrence is the problem");

// Invalid characters / leading digit / empty.
const invalid = {
  id: "ww_i",
  type: "webhook-wait",
  config: { outputs: [{ name: "2bad", type: "string" }, { name: "has space", type: "string" }, { name: "", type: "string" }] },
} as unknown as WorkflowNode;
const ip = validatePauseNodeOutputNames(invalid);
assert.equal(ip.length, 3);
assert.ok(ip.every(p => p.reason === "invalid"), "all three are invalid");

// Non-pause node → no problems.
const step = { id: "s", type: "step", stepType: "custom-ai", config: { outputs: [{ name: "payload" }] } } as unknown as WorkflowNode;
assert.deepEqual(validatePauseNodeOutputNames(step), [], "non-pause node ignored");

// Missing config → no throw, no problems.
const bare = { id: "ww_b", type: "webhook-wait" } as unknown as WorkflowNode;
assert.deepEqual(validatePauseNodeOutputNames(bare), []);

console.log("pause-node-output-names: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/core/src/utils/pause-node-output-names.test.ts`
Expected: FAIL — cannot find module `./pause-node-output-names.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/utils/pause-node-output-names.ts`:

```ts
import type { WorkflowNode } from "../types/flow.types.ts";
import { WEBHOOK_WAIT_RESERVED_KEYS } from "../types/webhook-wait.types.ts";
import { HUMAN_TASK_RESERVED_KEYS } from "../types/human-task.types.ts";

export type PauseOutputNameReason = "reserved" | "duplicate" | "invalid";

export interface PauseOutputNameProblem {
  name: string;
  /** Position in `config.outputs` — lets the editor target the offending row. */
  index: number;
  reason: PauseOutputNameReason;
  /** User-facing message that says what to do. */
  message: string;
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validate the declared output names on a `webhook-wait` / `human-task` node.
 * Returns one problem per offending output (check order: invalid → reserved →
 * duplicate, first match wins). Returns `[]` for clean sets and non-pause nodes.
 * Mirrors the converter's `validateOutputNames` rules so the editor catches the
 * same problems early.
 */
export function validatePauseNodeOutputNames(node: WorkflowNode): PauseOutputNameProblem[] {
  if (node.type !== "webhook-wait" && node.type !== "human-task") return [];

  const reserved = new Set<string>(
    node.type === "webhook-wait" ? WEBHOOK_WAIT_RESERVED_KEYS : HUMAN_TASK_RESERVED_KEYS,
  );
  const outputs = ((node.config ?? {}) as { outputs?: Array<{ name?: unknown }> }).outputs ?? [];

  const problems: PauseOutputNameProblem[] = [];
  const seen = new Set<string>();

  outputs.forEach((o, index) => {
    const name = typeof o?.name === "string" ? o.name : "";

    if (!NAME_RE.test(name)) {
      problems.push({
        name,
        index,
        reason: "invalid",
        message: `'${name}' is invalid — use letters, numbers, underscore; don't start with a digit.`,
      });
      return;
    }
    if (reserved.has(name)) {
      problems.push({ name, index, reason: "reserved", message: `'${name}' is reserved — pick another name.` });
      return;
    }
    if (seen.has(name)) {
      problems.push({ name, index, reason: "duplicate", message: `Duplicate output name '${name}'.` });
      return;
    }
    seen.add(name);
  });

  return problems;
}
```

- [ ] **Step 4: Export from the core barrel**

In `packages/core/src/index.ts`, find the line added by the previous feature:

```ts
export { pauseNodeOutputSchema } from "./utils/pause-node-output.ts";
```

Add immediately after it:

```ts
export { validatePauseNodeOutputNames } from "./utils/pause-node-output-names.ts";
export type { PauseOutputNameProblem, PauseOutputNameReason } from "./utils/pause-node-output-names.ts";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx packages/core/src/utils/pause-node-output-names.test.ts`
Expected: PASS — prints `pause-node-output-names: ok`.

*(No commit, no typecheck this task — per execution preferences.)*

---

## Task 2: Editor publish gate flags bad output names

**Files:**
- Modify: `packages/flow-editor/src/state/validation.ts:1-2` (imports) and the per-node loop at lines 43-56
- Test: `packages/flow-editor/src/state/validation.pause-output-names.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/flow-editor/src/state/validation.pause-output-names.test.ts`:

```ts
import assert from "node:assert/strict";
import type { WorkflowGraph } from "@journeyman/core";
import { isValidPhase4Graph } from "./validation.ts";

// Minimal valid linear flow: trigger → webhook-wait → end.
function baseFlow(outputs: Array<{ name: string; type: string }>): WorkflowGraph {
  return {
    schemaVersion: 2,
    nodes: [
      { id: "start", type: "trigger-manual" },
      { id: "ww", type: "webhook-wait", displayName: "Webhook Wait", config: { webhookId: "w1", outputs } },
      { id: "end", type: "end" },
    ],
    edges: [
      { id: "e1", type: "default", source: "start", target: "ww" },
      { id: "e2", type: "default", source: "ww", target: "end" },
    ],
  } as unknown as WorkflowGraph;
}

// Reserved output name → not ok, with a node-attributed error mentioning the name.
const bad = isValidPhase4Graph(baseFlow([{ name: "payload", type: "json" }]));
assert.equal(bad.ok, false, "reserved output name should fail the publish gate");
const issue = bad.issues.find(i => i.nodeId === "ww" && /payload/.test(i.message));
assert.ok(issue, `expected a node-attributed error mentioning 'payload', got ${JSON.stringify(bad.issues)}`);
assert.equal(issue!.severity, "error");

// Clean output name → no output-name error on the node.
const good = isValidPhase4Graph(baseFlow([{ name: "issueNumber", type: "number" }]));
const outErr = good.issues.find(i => i.nodeId === "ww" && /reserved|Duplicate|invalid/.test(i.message));
assert.equal(outErr, undefined, `clean output should not produce a name error, got ${JSON.stringify(outErr)}`);

console.log("validation.pause-output-names: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/flow-editor/src/state/validation.pause-output-names.test.ts`
Expected: FAIL — `bad.ok` is `true` (the gate doesn't check output names yet).

- [ ] **Step 3: Add the import**

In `packages/flow-editor/src/state/validation.ts`, find line 2:

```ts
import { isJsonLogicExpr, isTriggerNode, validateForkJoinPairs } from "@journeyman/core";
```

Replace it with (adds `validatePauseNodeOutputNames`):

```ts
import { isJsonLogicExpr, isTriggerNode, validateForkJoinPairs, validatePauseNodeOutputNames } from "@journeyman/core";
```

- [ ] **Step 4: Push errors in the per-node loop**

In the same file, find this block (the per-node loop, around lines 43-56):

```ts
  for (const n of flow.nodes) {
    if (n.type === "end") {
      if ((out.get(n.id) ?? 0) > 0) push("error", `End ${nodeLabel(n)} has outgoing edges`, n.id);
    }
    if (n.type === "gateway-xor" || n.type === "if") {
      if ((out.get(n.id) ?? 0) < 2) push("error", `Gateway/If ${nodeLabel(n)} needs at least 2 branches`, n.id);
    }
    if (n.type === "step" && !n.stepType) {
      push("error", `Step node ${nodeLabel(n)} is missing a step type`, n.id);
    }
    if (n.type === "subflow" && !(n.config as { workflowName?: string } | undefined)?.workflowName) {
      push("error", `Subflow ${nodeLabel(n)} is missing config.workflowName`, n.id);
    }
  }
```

Add the pause-node output-name check at the end of the loop body, right before the closing `}`:

```ts
  for (const n of flow.nodes) {
    if (n.type === "end") {
      if ((out.get(n.id) ?? 0) > 0) push("error", `End ${nodeLabel(n)} has outgoing edges`, n.id);
    }
    if (n.type === "gateway-xor" || n.type === "if") {
      if ((out.get(n.id) ?? 0) < 2) push("error", `Gateway/If ${nodeLabel(n)} needs at least 2 branches`, n.id);
    }
    if (n.type === "step" && !n.stepType) {
      push("error", `Step node ${nodeLabel(n)} is missing a step type`, n.id);
    }
    if (n.type === "subflow" && !(n.config as { workflowName?: string } | undefined)?.workflowName) {
      push("error", `Subflow ${nodeLabel(n)} is missing config.workflowName`, n.id);
    }
    for (const p of validatePauseNodeOutputNames(n)) {
      push("error", `Output '${p.name}' on ${nodeLabel(n)}: ${p.message}`, n.id);
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx packages/flow-editor/src/state/validation.pause-output-names.test.ts`
Expected: PASS — prints `validation.pause-output-names: ok`.

*(No commit, no typecheck this task.)*

---

## Task 3: Converter uses core reserved-key constants

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts` (imports + lines 409 and 438)

- [ ] **Step 1: Add the constants to the core import**

In `packages/orchestrator/src/flow-json/conductor-converter.ts`, find line 2:

```ts
import { getStartWorkflowInputs, isTriggerNode, findTriggerNodes, findManualTriggerNode, WORKFLOW_SCHEMA_VERSION } from "@journeyman/core";
```

Replace it with (adds the two reserved-key constants):

```ts
import { getStartWorkflowInputs, isTriggerNode, findTriggerNodes, findManualTriggerNode, WORKFLOW_SCHEMA_VERSION, HUMAN_TASK_RESERVED_KEYS, WEBHOOK_WAIT_RESERVED_KEYS } from "@journeyman/core";
```

- [ ] **Step 2: Replace the human-task inlined array**

Find line 409:

```ts
    this.validateOutputNames(node, outputs, ["source", "actor", "resolvedAt", "payload"], "Human-task");
```

Replace it with:

```ts
    this.validateOutputNames(node, outputs, HUMAN_TASK_RESERVED_KEYS, "Human-task");
```

- [ ] **Step 3: Replace the webhook-wait inlined array**

Find line 438:

```ts
    this.validateOutputNames(node, outputs, ["source", "resolvedAt", "webhookEventId", "payload"], "Webhook-wait");
```

Replace it with:

```ts
    this.validateOutputNames(node, outputs, WEBHOOK_WAIT_RESERVED_KEYS, "Webhook-wait");
```

- [ ] **Step 4: Confirm the signature still accepts the constants**

`validateOutputNames(node, outputs, reserved: readonly string[], label)` already takes `readonly string[]`; the `*_RESERVED_KEYS` constants are `readonly` tuples and are assignable. No further change needed. (Verified at final `npm run check`.)

*(No commit, no typecheck this task.)*

---

## Task 4: Inline per-field errors in both editors

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx` (imports + outputs `.map` rows)
- Modify: `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx` (imports + human-task outputs `.map` rows)

No automated test (React UI). Correctness is verified by the final `npm run check`; behaviour is the same `validatePauseNodeOutputNames` already unit-tested in Task 1.

- [ ] **Step 1: WebhookWaitConfigEditor — add the import**

In `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx`, find line 2:

```ts
import type { CorrelationKey, WorkflowInputValue, WorkflowNode } from "@journeyman/core";
```

Add this import immediately after it:

```ts
import { validatePauseNodeOutputNames } from "@journeyman/core";
```

- [ ] **Step 2: WebhookWaitConfigEditor — compute problems by row index**

In the same file, find this line (declared near the top of the component body):

```ts
  const outputs = cfg.outputs ?? [];
```

Add immediately after it:

```ts
  const nameProblems = useMemo(() => {
    const byIndex = new Map<number, string>();
    for (const p of validatePauseNodeOutputNames(node)) byIndex.set(p.index, p.message);
    return byIndex;
  }, [node]);
```

(`useMemo` is already imported on line 1: `import { useMemo, useState } from "react";`.)

- [ ] **Step 3: WebhookWaitConfigEditor — render the inline note**

In the same file, find the output row's remove button and its closing `</div>` inside the `outputs.map((o, i) => (...))`:

```tsx
            <button
              type="button"
              disabled={readOnly}
              onClick={() => removeOutput(i)}
              style={{ flex: "0 0 auto" }}
            >
              ×
            </button>
          </div>
        ))}
```

Replace it with (wraps the row so the error renders under it):

```tsx
            <button
              type="button"
              disabled={readOnly}
              onClick={() => removeOutput(i)}
              style={{ flex: "0 0 auto" }}
            >
              ×
            </button>
            {nameProblems.has(i) && (
              <p className="je-hint je-hint--error" style={{ flexBasis: "100%" }}>{nameProblems.get(i)}</p>
            )}
          </div>
        ))}
```

- [ ] **Step 4: ControlNodeConfigTab — add the import**

In `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx`, find line 17:

```ts
import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";
```

Replace it with:

```ts
import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";
import { validatePauseNodeOutputNames } from "@journeyman/core";
```

- [ ] **Step 5: ControlNodeConfigTab — ensure `useMemo` is imported**

In the same file, find line 16:

```ts
import { useState } from "react";
```

Replace it with:

```ts
import { useState, useMemo } from "react";
```

- [ ] **Step 6: ControlNodeConfigTab — compute problems by row index**

In `HumanTaskConfigEditor`, find this line:

```ts
  const outputs = cfg.outputs ?? [];
```

Add immediately after it:

```ts
  const nameProblems = useMemo(() => {
    const byIndex = new Map<number, string>();
    for (const p of validatePauseNodeOutputNames(node)) byIndex.set(p.index, p.message);
    return byIndex;
  }, [node]);
```

- [ ] **Step 7: ControlNodeConfigTab — render the inline note**

In the same component, find the end of the output row — the remove button and the row's closing `</div>`:

```tsx
              {!readOnly && (
                <button
                  type="button"
                  className="je-humantask__chip-x"
                  aria-label="Remove output"
                  onClick={() => removeOutput(i)}
                >×</button>
              )}
            </div>
          ))}
```

Replace it with:

```tsx
              {!readOnly && (
                <button
                  type="button"
                  className="je-humantask__chip-x"
                  aria-label="Remove output"
                  onClick={() => removeOutput(i)}
                >×</button>
              )}
              {nameProblems.has(i) && (
                <p className="je-hint je-hint--error" style={{ flexBasis: "100%" }}>{nameProblems.get(i)}</p>
              )}
            </div>
          ))}
```

*(No commit, no typecheck this task.)*

---

## Task 5: Final verification (the only check/typecheck run)

**Files:** none (verification only)

- [ ] **Step 1: Run the full repo check**

Run: `npm run check`
Expected: typecheck passes for all workspaces and the import-boundary check passes (`✓ Layer boundaries clean across all packages.`). flow-editor and orchestrator importing from `@journeyman/core` is allowed.

- [ ] **Step 2: Re-run all logic tests touched by this plan**

Run:
```bash
npx tsx packages/core/src/utils/pause-node-output-names.test.ts
npx tsx packages/flow-editor/src/state/validation.pause-output-names.test.ts
```
Expected: each prints its `... : ok` line.

- [ ] **Step 3: Regression — earlier features still green**

Run:
```bash
npx tsx packages/core/src/utils/pause-node-output.test.ts
npx tsx packages/orchestrator/src/flow-json/validate-ref-shape.pause-node.test.ts
npx tsx packages/flow-editor/src/properties-panel/pause-node-source.test.ts
```
Expected: each prints its `... : ok` line.

- [ ] **Step 4: Manual UI sanity (optional, when running the app)**

In the flow editor, add an output named `payload` to a Webhook Wait node. Expected: a red note appears under the field ("'payload' is reserved — pick another name."), and the topbar shows a publish-blocking error attributed to that node.

---

## Self-Review

**Spec coverage:**
- Spec §1 (core `validatePauseNodeOutputNames`, all three reasons, reuse reserved constants) → Task 1. ✅
- Spec §2 (editor publish gate via `isValidPhase4Graph`) → Task 2. ✅
- Spec §3 (inline warning in WebhookWaitConfigEditor + human-task outputs) → Task 4. ✅
- Spec §4 (converter de-dup using core constants) → Task 3. ✅
- Spec §Testing (core checker / editor gate / converter backstop) → Task 1 test, Task 2 test, Task 5 regression. ✅
- Spec §Acceptance (inline note, publish blocked, converter still rejects, editor/converter agree) → Tasks 2–4 + Task 5 Steps 1/4. ✅

**Placeholder scan:** No TBD/TODO. Every code step shows full code; every run step shows the command + expected output. Task 4 has no unit test by design (React UI) and says so explicitly. ✅

**Type consistency:** `validatePauseNodeOutputNames(node): PauseOutputNameProblem[]` with fields `{ name, index, reason, message }` is defined in Task 1 and consumed identically in Tasks 2 and 4 (`p.name`, `p.index`, `p.message`). `PauseOutputNameReason` union `"reserved" | "duplicate" | "invalid"` matches the test assertions. The converter's `validateOutputNames(..., reserved: readonly string[], ...)` accepts the `readonly` `*_RESERVED_KEYS` tuples (Task 3). ✅

**Execution-preference compliance:** No task contains a `git commit` step; no task runs `npm run typecheck` except the final `npm run check` in Task 5. ✅
