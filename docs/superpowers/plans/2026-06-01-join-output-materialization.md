# Join Output Materialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `join_<id>.output.{winner,output,results}` resolve to real values at runtime by materializing the `JoinNodeOutput` shape via a post-JOIN worker task, so join bindings stop resolving to `null`.

**Architecture:** The converter emits the native Conductor `JOIN` under an internal ref `join_<id>__join`, then a `SIMPLE` `join-finalize` task whose `taskReferenceName` is the node id (`join_<id>`) — so downstream refs resolve to its output. The finalize task runs a pure transform that reads the raw JOIN branch map + `mode` + `branchTaskRefs` and computes `{winner, output, results}`. `fail-fast` joins are unchanged. The editor's join output schema lists `output` first to steer authors away from `winner`.

**Tech Stack:** TypeScript, `@journeyman/orchestrator` (Conductor converter + worker harness), `@journeyman/core` types, vitest.

**Constraints (per request):** No git commits in any step. The final task runs `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-06-01-join-output-materialization-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/orchestrator/src/workers/steps/join-finalize.ts` | **New.** Pure `materializeJoinOutput(mode, raw, branchTaskRefs)`. No I/O. |
| `packages/orchestrator/src/workers/steps/join-finalize.test.ts` | **New.** vitest tests for the pure transform. |
| `packages/orchestrator/src/workers/steps/join-finalize-step-handler.ts` | **New.** `JoinFinalizeStepHandler` (thin wrapper). |
| `packages/orchestrator/src/workers/steps/join-finalize-step-handler.test.ts` | **New.** vitest tests for the handler (delegation + bad-input failure). |
| `packages/orchestrator/src/flow-json/conductor-converter.ts` | `emitJoin`: rename native JOIN to `join_<id>__join` + emit the `join-finalize` task for field-bearing modes. |
| `packages/orchestrator/src/flow-json/conductor-converter.join-finalize.test.ts` | **New.** vitest converter tests. |
| `packages/orchestrator/src/cli-worker.ts` | Register `JoinFinalizeStepHandler`. |
| `packages/orchestrator/src/index.ts` | Export `JoinFinalizeStepHandler`. |
| `packages/core/src/utils/join-node-output.ts` | first-wins: `output` first + field descriptions. |
| `packages/core/src/utils/join-node-output.test.ts` | **New.** vitest test for schema field order + presence. |
| `packages/orchestrator/src/sync/first-wins-controller.test.ts` | Add a regression test: controller still locates the renamed JOIN ref. |

---

## Task 1: Pure transform `materializeJoinOutput`

**Files:**
- Create: `packages/orchestrator/src/workers/steps/join-finalize.ts`
- Test: `packages/orchestrator/src/workers/steps/join-finalize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/workers/steps/join-finalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { materializeJoinOutput } from "./join-finalize.ts";

const CANCELLED = { cancelled: true, cancelledBy: "first-wins-controller", joinTaskRef: "join_x" };

describe("materializeJoinOutput — first-wins", () => {
  it("picks the non-cancelled branch as winner; output is its terminal output", () => {
    const raw = {
      "webhook-wait_pbfs1v": CANCELLED,
      "human-task_vy3p35": { data: { data: "dummy" }, source: "manual" },
    };
    const out = materializeJoinOutput("first-wins", raw, [["webhook-wait_pbfs1v"], ["human-task_vy3p35"]]);
    expect(out.winner).toBe("human-task_vy3p35");
    expect(out.output).toEqual({ data: { data: "dummy" }, source: "manual" });
    expect(out.results).toEqual({
      "human-task_vy3p35": { status: "success", output: { data: { data: "dummy" }, source: "manual" } },
    });
  });

  it("respects branchTaskRefs order when several branches are non-cancelled", () => {
    const raw = { a: { v: 1 }, b: { v: 2 } };
    const out = materializeJoinOutput("first-wins", raw, [["a"], ["b"]]);
    expect(out.winner).toBe("a");
    expect(out.output).toEqual({ v: 1 });
  });

  it("falls back to the first branch when all look cancelled", () => {
    const raw = { a: CANCELLED, b: CANCELLED };
    const out = materializeJoinOutput("first-wins", raw, [["a"], ["b"]]);
    expect(out.winner).toBe("a");
  });

  it("uses head id for winner and terminal output for output on multi-node branches", () => {
    const raw = { a_term: CANCELLED, b_term: { ok: true } };
    const out = materializeJoinOutput("first-wins", raw, [["a_head", "a_term"], ["b_head", "b_term"]]);
    expect(out.winner).toBe("b_head");
    expect(out.output).toEqual({ ok: true });
    expect(out.results).toEqual({ "b_head": { status: "success", output: { ok: true } } });
  });
});

describe("materializeJoinOutput — wait-all", () => {
  it("returns results keyed by branch head id with each terminal output", () => {
    const raw = { a_term: { x: 1 }, b_term: { y: 2 } };
    const out = materializeJoinOutput("wait-all", raw, [["a_head", "a_term"], ["b_head", "b_term"]]);
    expect(out.winner).toBeUndefined();
    expect(out.output).toBeUndefined();
    expect(out.results).toEqual({
      a_head: { status: "success", output: { x: 1 } },
      b_head: { status: "success", output: { y: 2 } },
    });
  });

  it("wait-all-strict behaves the same shape as wait-all", () => {
    const out = materializeJoinOutput("wait-all-strict", { t: { z: 9 } }, [["h", "t"]]);
    expect(out.results).toEqual({ h: { status: "success", output: { z: 9 } } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/orchestrator/src/workers/steps/join-finalize.test.ts`
Expected: FAIL — `Cannot find module './join-finalize.ts'`.

- [ ] **Step 3: Write the module**

Create `packages/orchestrator/src/workers/steps/join-finalize.ts`:

```ts
import type { JoinMode, JoinNodeOutput, JoinBranchResult } from "@journeyman/core";

/** A loser cancelled by the first-wins-controller has `cancelled: true`. */
function isCancelled(v: unknown): boolean {
  return typeof v === "object" && v !== null && (v as { cancelled?: unknown }).cancelled === true;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/**
 * Materialize the documented Join output shape from the raw Conductor JOIN
 * branch map. `raw` is keyed by each branch's terminal ref; `branchTaskRefs[i]`
 * is branch i's full node-id chain (head = chain[0], terminal = chain[last]).
 */
export function materializeJoinOutput(
  mode: JoinMode,
  raw: Record<string, unknown>,
  branchTaskRefs: string[][],
): JoinNodeOutput {
  const branches = branchTaskRefs
    .filter((chain) => chain.length > 0)
    .map((chain) => ({ head: chain[0], terminal: chain[chain.length - 1] }));

  if (mode === "wait-all" || mode === "wait-all-strict") {
    const results: Record<string, JoinBranchResult> = {};
    for (const { head, terminal } of branches) {
      results[head] = { status: "success", output: asRecord(raw[terminal]) };
    }
    return { results };
  }

  // first-wins (and any unknown mode defaults here)
  const winnerBranch = branches.find((b) => !isCancelled(raw[b.terminal])) ?? branches[0];
  if (!winnerBranch) return { results: {} };
  const output = asRecord(raw[winnerBranch.terminal]);
  return {
    winner: winnerBranch.head,
    ...(output ? { output } : {}),
    results: { [winnerBranch.head]: { status: "success", output } },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/orchestrator/src/workers/steps/join-finalize.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Verify (no commit — per request).** Leave changes in the working tree.

---

## Task 2: Worker handler `JoinFinalizeStepHandler`

**Files:**
- Create: `packages/orchestrator/src/workers/steps/join-finalize-step-handler.ts`
- Test: `packages/orchestrator/src/workers/steps/join-finalize-step-handler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/workers/steps/join-finalize-step-handler.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { JoinFinalizeStepHandler } from "./join-finalize-step-handler.ts";
import type { StepContext } from "@journeyman/core";

const ctx = {
  workflowInstanceId: "wf", nodeId: "join", attempt: 1, workspaceDir: "/tmp",
  signal: new AbortController().signal, env: {}, workflowInputs: {}, log: () => {},
} as unknown as StepContext;

describe("JoinFinalizeStepHandler", () => {
  it("declares stepType join-finalize", () => {
    expect(new JoinFinalizeStepHandler().stepType).toBe("join-finalize");
  });

  it("delegates to materializeJoinOutput and returns success", async () => {
    const res = await new JoinFinalizeStepHandler().run(
      { mode: "first-wins", raw: { a: { v: 1 } }, branchTaskRefs: [["a"]] },
      ctx,
    );
    expect(res.kind).toBe("success");
    if (res.kind === "success") {
      expect(res.output.winner).toBe("a");
      expect(res.output.output).toEqual({ v: 1 });
    }
  });

  it("fails with InvalidInput when branchTaskRefs is missing", async () => {
    const res = await new JoinFinalizeStepHandler().run({ mode: "first-wins", raw: {} }, ctx);
    expect(res.kind).toBe("failure");
    if (res.kind === "failure") {
      expect(res.failure.errorClass).toBe("InvalidInput");
      expect(res.failure.retryable).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/orchestrator/src/workers/steps/join-finalize-step-handler.test.ts`
Expected: FAIL — `Cannot find module './join-finalize-step-handler.ts'`.

- [ ] **Step 3: Write the handler**

Create `packages/orchestrator/src/workers/steps/join-finalize-step-handler.ts`:

```ts
import type { IStepHandler, StepInput, StepContext, StepRunResult, JoinMode } from "@journeyman/core";
import { materializeJoinOutput } from "./join-finalize.ts";

/**
 * Synthetic step emitted by the converter after a field-bearing JOIN. Reads the
 * raw Conductor JOIN branch map and computes the documented {winner, output,
 * results} shape so downstream `join_<id>.output.*` refs resolve.
 */
export class JoinFinalizeStepHandler implements IStepHandler {
  readonly stepType = "join-finalize";

  async run(input: StepInput, _ctx: StepContext): Promise<StepRunResult> {
    const mode = input.mode as JoinMode | undefined;
    const raw = (typeof input.raw === "object" && input.raw !== null ? input.raw : {}) as Record<string, unknown>;
    const branchTaskRefs = input.branchTaskRefs;
    if (!mode || !Array.isArray(branchTaskRefs)) {
      return {
        kind: "failure",
        failure: { errorClass: "InvalidInput", message: "join-finalize requires `mode` and `branchTaskRefs`", retryable: false },
      };
    }
    const output = materializeJoinOutput(mode, raw, branchTaskRefs as string[][]);
    return { kind: "success", output: output as Record<string, unknown> };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/orchestrator/src/workers/steps/join-finalize-step-handler.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify (no commit — per request).**

---

## Task 3: Emit the finalize task in the converter

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts` (`emitJoin`, ~line 598-640)
- Test: `packages/orchestrator/src/flow-json/conductor-converter.join-finalize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/flow-json/conductor-converter.join-finalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { WorkflowGraph } from "@journeyman/core";
import { ConductorJsonConverter } from "./conductor-converter.ts";

function n(node: Partial<WorkflowGraph["nodes"][number]> & { id: string; type: string }) {
  return { position: { x: 0, y: 0 }, config: {}, ...node } as unknown as WorkflowGraph["nodes"][number];
}

function forkJoinGraph(joinMode: string): WorkflowGraph {
  return {
    schemaVersion: 2,
    inputDefs: [],
    nodes: [
      n({ id: "start", type: "trigger-manual" }),
      n({ id: "fork", type: "gateway-and", displayName: "Fork" }),
      n({ id: "a", type: "step", stepType: "custom-ai", displayName: "A", inputs: {} }),
      n({ id: "b", type: "step", stepType: "custom-ai", displayName: "B", inputs: {} }),
      n({ id: "join", type: "join", displayName: "Join", config: { mode: joinMode } }),
      n({ id: "reader", type: "step", stepType: "custom-ai", displayName: "Reader", inputs: {} }),
      n({ id: "end", type: "end" }),
    ],
    edges: [
      { id: "e0", type: "default", source: "start", target: "fork" },
      { id: "e1", type: "default", source: "fork", target: "a" },
      { id: "e2", type: "default", source: "fork", target: "b" },
      { id: "e3", type: "default", source: "a", target: "join" },
      { id: "e4", type: "default", source: "b", target: "join" },
      { id: "e5", type: "default", source: "join", target: "reader" },
      { id: "e6", type: "default", source: "reader", target: "end" },
    ],
  } as unknown as WorkflowGraph;
}

function findTask(def: { tasks: Array<Record<string, unknown>> }, predicate: (t: Record<string, unknown>) => boolean) {
  return def.tasks.find(predicate);
}

describe("conductor-converter — join finalize", () => {
  it("first-wins: renames JOIN and emits a join-finalize task owning the node id", () => {
    const def = new ConductorJsonConverter().toEngineJson(forkJoinGraph("first-wins"), {
      workflowName: "fj", workflowVersion: 1,
    }) as unknown as { tasks: Array<Record<string, unknown>> };

    const join = findTask(def, (t) => t.type === "JOIN");
    expect(join?.taskReferenceName).toBe("join__join");

    const finalize = findTask(def, (t) => t.name === "join-finalize");
    expect(finalize).toBeDefined();
    expect(finalize?.taskReferenceName).toBe("join");
    const ip = finalize?.inputParameters as Record<string, unknown>;
    expect(ip.raw).toBe("${join__join.output}");
    expect(ip.mode).toBe("first-wins");
    expect(ip.branchTaskRefs).toEqual([["a"], ["b"]]);
  });

  it("wait-all: also emits a join-finalize task", () => {
    const def = new ConductorJsonConverter().toEngineJson(forkJoinGraph("wait-all"), {
      workflowName: "fj", workflowVersion: 1,
    }) as unknown as { tasks: Array<Record<string, unknown>> };
    expect(findTask(def, (t) => t.type === "JOIN")?.taskReferenceName).toBe("join__join");
    expect(findTask(def, (t) => t.name === "join-finalize")).toBeDefined();
  });

  it("fail-fast: JOIN keeps the node id and no finalize task is emitted", () => {
    const def = new ConductorJsonConverter().toEngineJson(forkJoinGraph("fail-fast"), {
      workflowName: "fj", workflowVersion: 1,
    }) as unknown as { tasks: Array<Record<string, unknown>> };
    expect(findTask(def, (t) => t.type === "JOIN")?.taskReferenceName).toBe("join");
    expect(findTask(def, (t) => t.name === "join-finalize")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/orchestrator/src/flow-json/conductor-converter.join-finalize.test.ts`
Expected: FAIL — first-wins JOIN ref is still `join` (not `join__join`) and no `join-finalize` task exists.

- [ ] **Step 3: Update `emitJoin`**

In `packages/orchestrator/src/flow-json/conductor-converter.ts`, replace the tail of `emitJoin` (from `const join: JoinTask = {` through its `return` — currently lines ~628-640):

```ts
    const join: JoinTask = {
      type: "JOIN",
      name: `join_${node.id}`,
      taskReferenceName: node.id,
      joinOn,
      inputParameters: {
        mode,
        branchTaskRefs,
        ...(cfg.description ? { description: cfg.description } : {}),
      },
    };

    return { tasks: [join], nextNodeId: this.successor(node.id) };
```

with:

```ts
    // fail-fast exposes no join-level fields, so the native JOIN keeps the node
    // id and no finalize task is needed. Field-bearing modes rename the native
    // JOIN to an internal ref and add a `join-finalize` worker task that owns
    // the node id, so downstream `join_<id>.output.*` refs resolve to the
    // materialized {winner, output, results} shape.
    if (mode === "fail-fast") {
      const join: JoinTask = {
        type: "JOIN",
        name: `join_${node.id}`,
        taskReferenceName: node.id,
        joinOn,
        inputParameters: { mode, branchTaskRefs, ...(cfg.description ? { description: cfg.description } : {}) },
      };
      return { tasks: [join], nextNodeId: this.successor(node.id) };
    }

    const joinRef = `${node.id}__join`;
    const join: JoinTask = {
      type: "JOIN",
      name: `join_${node.id}`,
      taskReferenceName: joinRef,
      joinOn,
      inputParameters: { mode, branchTaskRefs, ...(cfg.description ? { description: cfg.description } : {}) },
    };
    const finalize: SimpleTask = {
      type: "SIMPLE",
      name: "join-finalize",
      taskReferenceName: node.id,
      inputParameters: {
        raw: "${" + joinRef + ".output}",
        mode,
        branchTaskRefs,
      },
    };
    return { tasks: [join, finalize], nextNodeId: this.successor(node.id) };
```

- [ ] **Step 4: Ensure `SimpleTask` is imported**

`emitStep` already uses `SimpleTask`, so the type is imported. Confirm the import line near the top of `conductor-converter.ts` includes `SimpleTask` (alongside `JoinTask`, `ForkJoinTask`, etc.). If not, add it to the `conductor-types.ts` import. (No change expected — verified during planning.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/orchestrator/src/flow-json/conductor-converter.join-finalize.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the existing converter tests (no regressions)**

Run: `npx vitest run packages/orchestrator/src/flow-json/`
Expected: PASS (cross-branch, fork-validation, trigger-fan-in, resolve-inputs, validate-ref-shape, etc.).

- [ ] **Step 7: Verify (no commit — per request).**

---

## Task 4: Register the handler

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`
- Modify: `packages/orchestrator/src/index.ts`

- [ ] **Step 1: Import and register in `cli-worker.ts`**

Near the other step-handler imports (around line 44-45), add:

```ts
import { JoinFinalizeStepHandler } from "./workers/steps/join-finalize-step-handler.ts";
```

Near the other `registry.register(...)` calls (e.g. after the workspace handlers around line 80), add:

```ts
registry.register(new JoinFinalizeStepHandler());
```

(The harness polls `registry.list().map(h => h.stepType)`, so `join-finalize` is auto-added to the polled set — no separate list edit.)

- [ ] **Step 2: Export from the orchestrator barrel**

In `packages/orchestrator/src/index.ts`, near the other handler exports (e.g. the `SendMessageStepHandler` export ~line 63), add:

```ts
export { JoinFinalizeStepHandler } from "./workers/steps/join-finalize-step-handler.ts";
```

- [ ] **Step 3: Typecheck the package**

Run: `npm run typecheck -w @journeyman/orchestrator`
Expected: PASS.

- [ ] **Step 4: Verify (no commit — per request).**

---

## Task 5: Editor nudge — `output` first in the join output schema

**Files:**
- Modify: `packages/core/src/utils/join-node-output.ts`
- Test: `packages/core/src/utils/join-node-output.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/utils/join-node-output.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { joinNodeOutputSchema } from "./join-node-output.ts";
import type { WorkflowNode } from "../types/flow.types.ts";

function joinNode(mode: string): WorkflowNode {
  return { id: "join", type: "join", config: { mode } } as unknown as WorkflowNode;
}

describe("joinNodeOutputSchema", () => {
  it("first-wins lists `output` first and includes winner + results", () => {
    const schema = joinNodeOutputSchema(joinNode("first-wins"))!;
    expect(Object.keys(schema)).toEqual(["output", "winner", "results"]);
    expect(schema.winner.type).toBe("string");
    expect(schema.output.type).toBe("object");
    expect(schema.results.type).toBe("object");
  });

  it("wait-all exposes only results", () => {
    expect(Object.keys(joinNodeOutputSchema(joinNode("wait-all"))!)).toEqual(["results"]);
  });

  it("fail-fast exposes nothing", () => {
    expect(joinNodeOutputSchema(joinNode("fail-fast"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/utils/join-node-output.test.ts`
Expected: FAIL — current first-wins key order is `["winner", "output", "results"]`, not `["output", "winner", "results"]`.

- [ ] **Step 3: Reorder the first-wins schema and add descriptions**

In `packages/core/src/utils/join-node-output.ts`, replace the `first-wins` branch:

```ts
  if (mode === "first-wins") {
    return { winner: { type: "string" }, output: jsonObject, results: jsonObject };
  }
```

with:

```ts
  if (mode === "first-wins") {
    return {
      output: { type: "object", fields: {}, description: "The winning branch's result — use this for downstream data." },
      winner: { type: "string", description: "Name of the branch that won (a label, not data)." },
      results: { type: "object", fields: {}, description: "All branch results (winning entry only)." },
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/utils/join-node-output.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the JoinConfigEditor preview to lead with `output`**

In `packages/flow-editor/src/properties-panel/JoinConfigEditor.tsx` (~line 154), replace:

```tsx
  if (mode === "first-wins") return JSON.stringify({ winner: "<branchHeadNodeId>", output: "<winning branch's last node output>" }, null, 2);
```

with:

```tsx
  if (mode === "first-wins") return JSON.stringify({ output: "<winning branch's data — bind this>", winner: "<branch label, not data>" }, null, 2);
```

- [ ] **Step 6: Verify (no commit — per request).**

---

## Task 6: first-wins-controller regression test (renamed JOIN ref)

**Files:**
- Modify: `packages/orchestrator/src/sync/first-wins-controller.test.ts`

The controller finds joins by `taskType === "JOIN"`, not by ref name, so the `join_<id>__join` rename must not break it. Add a test proving it.

- [ ] **Step 1: Add the regression test**

Append a new `it(...)` inside the existing `describe("applyFirstWinsCancellation", ...)` block in `packages/orchestrator/src/sync/first-wins-controller.test.ts`:

```ts
  it("still locates and resolves a JOIN whose ref was renamed to join_<id>__join", async () => {
    const { client, completed } = fakeConductor([
      { taskId: "ht", taskType: "HUMAN", referenceTaskName: "human-task_vy3p35", status: "COMPLETED", inputData: {} },
      { taskId: "ww", taskType: "HUMAN", referenceTaskName: "webhook-wait_pbfs1v", status: "IN_PROGRESS", inputData: {} },
      {
        taskId: "join-id",
        taskType: "JOIN",
        referenceTaskName: "join_8a8gat__join",
        status: "IN_PROGRESS",
        inputData: { joinOn: ["webhook-wait_pbfs1v", "human-task_vy3p35"] },
        workflowTask: {
          type: "JOIN",
          joinOn: ["webhook-wait_pbfs1v", "human-task_vy3p35"],
          inputParameters: {
            mode: "first-wins",
            branchTaskRefs: [["webhook-wait_pbfs1v"], ["human-task_vy3p35"]],
          },
        },
      },
    ]);

    const { cancelled } = await applyFirstWinsCancellation(client, "wf");
    expect(cancelled).toContain("webhook-wait_pbfs1v");
    expect(completed.map(c => c.taskId)).toContain("ww");
  });
```

- [ ] **Step 2: Run the controller tests**

Run: `npx vitest run packages/orchestrator/src/sync/first-wins-controller.test.ts`
Expected: PASS (existing + new test).

- [ ] **Step 3: Verify (no commit — per request).**

---

## Task 7: Final typecheck (whole monorepo) + test sweep

**Files:** none

- [ ] **Step 1: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS across all workspaces. Resolve any reported type errors in the files touched above before finishing.

- [ ] **Step 2: Re-run the new/affected tests together**

Run:
```bash
npx vitest run \
  packages/orchestrator/src/workers/steps/join-finalize.test.ts \
  packages/orchestrator/src/workers/steps/join-finalize-step-handler.test.ts \
  packages/orchestrator/src/flow-json/conductor-converter.join-finalize.test.ts \
  packages/orchestrator/src/sync/first-wins-controller.test.ts \
  packages/core/src/utils/join-node-output.test.ts
```
Expected: all PASS.

- [ ] **Step 3: Done — leave all changes uncommitted (per request).**

---

## Self-Review Notes

- **Spec coverage:** converter rename + finalize emission (Task 3) ✓; pure transform for all field-bearing modes (Task 1) ✓; worker handler + registration (Tasks 2, 4) ✓; `output`-first editor nudge + descriptions + preview (Task 5) ✓; first-wins-controller compatibility (Task 6) ✓; run-viewer visibility is a free consequence of the finalize task producing an execution row (no extra task needed) ✓; final typecheck, no commits (Task 7) ✓.
- **Out of scope (unchanged):** `fail-fast` join behavior; join node UI/config; worker per-step workspace creation.
- **Type consistency:** `materializeJoinOutput(mode, raw, branchTaskRefs)` signature matches across Task 1 (definition), its test, Task 2 (handler import), and the handler test. `JoinFinalizeStepHandler.stepType === "join-finalize"` matches the converter's emitted `name: "join-finalize"` (Task 3) so the worker poll/dispatch resolves. The JOIN ref `join_<id>__join` and finalize `raw: "${join_<id>__join.output}"` use the identical string in Task 3 and its test.
- **No placeholders:** every code/step block is concrete; all test fixtures are self-contained and based on the verified working fork/join converter fixture and the existing first-wins-controller fake client.
```
