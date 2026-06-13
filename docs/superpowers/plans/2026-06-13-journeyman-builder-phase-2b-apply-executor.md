# Journeyman Builder — Phase 2b: The Apply Executor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **apply executor** — given an approved `BuildPlan`, it creates the new custom-AI steps, rewrites the workflow graph so its `custom-ai` nodes reference the real step ids, creates the workflow as a **draft**, and rolls back the created steps if anything fails. Never publishes, never runs.

**Architecture:** A pure, dependency-injected module in `@journeyman/builder` (`src/apply/`). It does NOT import `pg` or the orchestrator directly — instead it takes three injected operations (`insertStep`, `deleteStep`, `createWorkflow`) so it is fully unit-testable without a database. The real wiring (binding `insertCustomAiStep(pool, …)`, `deleteCustomAiStep(pool, …)`, and `c.workflows.create(…)`) happens at the API layer in Phase 3.

**Tech Stack:** TypeScript (ESM, explicit `.ts` extensions), Vitest. Pure logic + injected effects.

**Constraints (from the user):** **No `git commit` steps.** **Final step is `npm run check`.** Each task ends by running its tests.

**Scope (Phase 2b):** the graph-rewrite helper + the apply executor with ordered create and rollback. **Out of scope:** re-validation (the API caller re-runs `/workflows/validate` with `proposedCustomSteps` before calling apply — Phase 3); conditional branching (Phase 2c).

**Reference:** Spec `docs/superpowers/specs/2026-06-13-journeyman-builder-design.md` ("Apply executor"). Builds on Phase 1 (`BuildPlan`/`ProposedCustomStep`) and Phase 2a (the assembler that produced the graph).

**Verified contracts (from codebase exploration):**
- `insertCustomAiStep(pool, input: CustomAiStepCreateInput & { orgId; userId: string|null; createdBy })` → full `CustomAiStep` (with `id`). On dup name throws `DuplicateCustomStepError`.
- `deleteCustomAiStep(pool, id)` → `boolean` (hard delete).
- `IWorkflowStore.create(args: CreateWorkflowArgs)` → `{ workflow, version }`. `CreateWorkflowArgs = { scope, name, description?, orgId: string|null, ownerUserId: string|null, initialDefinition: WorkflowGraph, createdByUserId: string|null }`. **Draft is the DB default** — never call `setStatus(id,"ready")`.
- `custom-ai` nodes carry `config.customStepId`.

---

## File Structure (Phase 2b)

**Create:**
- `packages/builder/src/apply/rewrite.ts` — pure: replace placeholder custom-step ids in a `WorkflowGraph`
- `packages/builder/src/apply/rewrite.test.ts`
- `packages/builder/src/apply/apply.ts` — `applyBuildPlan(deps, args)` (ordered create + rollback)
- `packages/builder/src/apply/apply.test.ts`

**Modify:**
- `packages/builder/src/index.ts` — export the apply entrypoint

---

## Task 1: Graph rewrite helper

**Files:**
- Create: `packages/builder/src/apply/rewrite.ts`
- Test: `packages/builder/src/apply/rewrite.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/builder/src/apply/rewrite.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rewriteCustomStepIds } from "./rewrite.ts";
import type { WorkflowGraph } from "@journeyman/core";

function graph(nodes: WorkflowGraph["nodes"]): WorkflowGraph {
  return { schemaVersion: 2, nodes, edges: [] };
}

describe("rewriteCustomStepIds", () => {
  it("replaces placeholder customStepId on custom-ai nodes", () => {
    const g = graph([
      { id: "n_1", type: "step", stepType: "custom-ai", config: { customStepId: "tmp-a", tools: ["read-file"] }, position: { x: 0, y: 0 } },
      { id: "n_2", type: "step", stepType: "get-issue", config: {}, position: { x: 1, y: 0 } },
    ]);
    const out = rewriteCustomStepIds(g, { "tmp-a": "real-123" });
    expect(out.nodes[0].config!.customStepId).toBe("real-123");
    expect(out.nodes[0].config!.tools).toEqual(["read-file"]); // other config untouched
    expect(out.nodes[1].config).toEqual({}); // non-custom-ai untouched
  });

  it("leaves ids that are not in the map unchanged", () => {
    const g = graph([
      { id: "n_1", type: "step", stepType: "custom-ai", config: { customStepId: "already-real" }, position: { x: 0, y: 0 } },
    ]);
    const out = rewriteCustomStepIds(g, { "tmp-a": "real-123" });
    expect(out.nodes[0].config!.customStepId).toBe("already-real");
  });

  it("does not mutate the input graph", () => {
    const g = graph([
      { id: "n_1", type: "step", stepType: "custom-ai", config: { customStepId: "tmp-a" }, position: { x: 0, y: 0 } },
    ]);
    rewriteCustomStepIds(g, { "tmp-a": "real-123" });
    expect(g.nodes[0].config!.customStepId).toBe("tmp-a"); // original unchanged
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/apply/rewrite.test.ts`
Expected: FAIL — cannot resolve `./rewrite.ts`.

- [ ] **Step 3: Create `packages/builder/src/apply/rewrite.ts`**

```ts
import type { WorkflowGraph } from "@journeyman/core";

/**
 * Return a copy of `graph` with every `custom-ai` node's `config.customStepId`
 * replaced according to `placeholderToReal`. Ids absent from the map are left
 * as-is. The input graph is not mutated.
 */
export function rewriteCustomStepIds(
  graph: WorkflowGraph,
  placeholderToReal: Record<string, string>,
): WorkflowGraph {
  const nodes = graph.nodes.map((n) => {
    if (n.type !== "step" || n.stepType !== "custom-ai") return n;
    const current = (n.config as { customStepId?: unknown } | undefined)?.customStepId;
    if (typeof current !== "string") return n;
    const real = placeholderToReal[current];
    if (!real) return n;
    return { ...n, config: { ...(n.config ?? {}), customStepId: real } };
  });
  return { ...graph, nodes };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/builder/src/apply/rewrite.test.ts`
Expected: PASS (3 tests).

---

## Task 2: The apply executor

**Files:**
- Create: `packages/builder/src/apply/apply.ts`
- Test: `packages/builder/src/apply/apply.test.ts`
- Modify: `packages/builder/src/index.ts`

The executor is dependency-injected: it receives `insertStep`, `deleteStep`, and `createWorkflow` as functions. It creates each `newCustomStep` (deriving per-step `userId` from the step's `scope`), records created ids for rollback, rewrites the graph, derives workflow `orgId`/`ownerUserId` from the workflow scope, creates the draft workflow, and on failure deletes everything it created.

- [ ] **Step 1: Write the failing test**

Create `packages/builder/src/apply/apply.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { applyBuildPlan, type ApplyDeps } from "./apply.ts";
import type { BuildPlan, CreateWorkflowArgs } from "@journeyman/core";

function planWith(custom: BuildPlan["newCustomSteps"], graph: BuildPlan["workflow"]): BuildPlan {
  return { newCustomSteps: custom, workflow: graph, defaults: { sandboxId: null, model: null }, stepBindings: [], gaps: [], summary: "s" };
}

const baseArgs = { workflowName: "PR review", scope: "user" as const, orgId: "o1", userId: "u1", createdBy: "u1" };

describe("applyBuildPlan", () => {
  it("creates steps, rewrites ids, and creates a draft workflow", async () => {
    const insertStep = vi.fn(async (input: any) => ({ id: `real-${input.name}` }));
    const createWorkflow = vi.fn(async (_args: CreateWorkflowArgs) => ({ workflowId: "wf-1", versionId: "v-1" }));
    const deleteStep = vi.fn(async () => {});
    const deps: ApplyDeps = { insertStep, deleteStep, createWorkflow };

    const plan = planWith(
      [{ id: "tmp-a", step: { scope: "user", name: "Review" } }],
      { schemaVersion: 2, nodes: [
        { id: "n_1", type: "step", stepType: "custom-ai", config: { customStepId: "tmp-a" }, position: { x: 0, y: 0 } },
      ], edges: [] },
    );

    const res = await applyBuildPlan(deps, { ...baseArgs, plan });

    expect(insertStep).toHaveBeenCalledTimes(1);
    // user-scoped step → userId is the acting user
    expect(insertStep.mock.calls[0][0]).toMatchObject({ name: "Review", orgId: "o1", userId: "u1", createdBy: "u1" });
    // graph passed to createWorkflow has the real id
    const passedGraph = (createWorkflow.mock.calls[0][0] as CreateWorkflowArgs).initialDefinition;
    expect(passedGraph.nodes[0].config!.customStepId).toBe("real-Review");
    // user-scope workflow → ownerUserId set, orgId set
    expect(createWorkflow.mock.calls[0][0]).toMatchObject({ scope: "user", name: "PR review", orgId: "o1", ownerUserId: "u1" });
    expect(res).toEqual({ workflowId: "wf-1", versionId: "v-1", createdStepIds: ["real-Review"], placeholderToRealId: { "tmp-a": "real-Review" } });
    expect(deleteStep).not.toHaveBeenCalled();
  });

  it("rolls back created steps when workflow creation fails", async () => {
    const insertStep = vi.fn(async (input: any) => ({ id: `real-${input.name}` }));
    const createWorkflow = vi.fn(async () => { throw new Error("boom"); });
    const deleteStep = vi.fn(async () => {});
    const deps: ApplyDeps = { insertStep, deleteStep, createWorkflow };

    const plan = planWith(
      [{ id: "tmp-a", step: { scope: "user", name: "A" } }, { id: "tmp-b", step: { scope: "user", name: "B" } }],
      { schemaVersion: 2, nodes: [], edges: [] },
    );

    await expect(applyBuildPlan(deps, { ...baseArgs, plan })).rejects.toThrow("boom");
    // both created steps deleted (rollback), newest-first
    expect(deleteStep.mock.calls.map((c) => c[0])).toEqual(["real-B", "real-A"]);
  });

  it("derives org-scope workflow owner as null and org-scoped step userId as null", async () => {
    const insertStep = vi.fn(async (input: any) => ({ id: "real-x" }));
    const createWorkflow = vi.fn(async () => ({ workflowId: "wf", versionId: "v" }));
    const deps: ApplyDeps = { insertStep, deleteStep: vi.fn(async () => {}), createWorkflow };

    const plan = planWith(
      [{ id: "tmp-a", step: { scope: "org", name: "Shared" } }],
      { schemaVersion: 2, nodes: [], edges: [] },
    );
    await applyBuildPlan(deps, { workflowName: "w", scope: "org", orgId: "o1", userId: "u1", createdBy: "u1", plan });

    expect(insertStep.mock.calls[0][0]).toMatchObject({ userId: null }); // org-scoped step
    expect(createWorkflow.mock.calls[0][0]).toMatchObject({ scope: "org", orgId: "o1", ownerUserId: null });
  });

  it("creates the workflow directly when there are no new steps", async () => {
    const insertStep = vi.fn();
    const createWorkflow = vi.fn(async () => ({ workflowId: "wf", versionId: "v" }));
    const deps: ApplyDeps = { insertStep, deleteStep: vi.fn(), createWorkflow };
    const plan = planWith([], { schemaVersion: 2, nodes: [], edges: [] });
    const res = await applyBuildPlan(deps, { ...baseArgs, plan });
    expect(insertStep).not.toHaveBeenCalled();
    expect(res.createdStepIds).toEqual([]);
    expect(res.workflowId).toBe("wf");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/apply/apply.test.ts`
Expected: FAIL — cannot resolve `./apply.ts`.

- [ ] **Step 3: Create `packages/builder/src/apply/apply.ts`**

```ts
import type {
  BuildPlan, CustomAiStepCreateInput, WorkflowScope, CreateWorkflowArgs,
} from "@journeyman/core";
import { rewriteCustomStepIds } from "./rewrite.ts";

/** Injected effects, so the executor is testable without a DB/orchestrator. */
export interface ApplyDeps {
  /** Create one custom step; returns at least its new id. */
  insertStep(
    input: CustomAiStepCreateInput & { orgId: string; userId: string | null; createdBy: string },
  ): Promise<{ id: string }>;
  /** Hard-delete a created step (rollback). */
  deleteStep(id: string): Promise<void>;
  /** Create the draft workflow; returns the new workflow + version ids. */
  createWorkflow(args: CreateWorkflowArgs): Promise<{ workflowId: string; versionId: string }>;
}

export interface ApplyArgs {
  plan: BuildPlan;
  workflowName: string;
  scope: WorkflowScope;          // "user" | "org" | "global"
  orgId: string | null;
  userId: string | null;
  createdBy: string | null;
}

export interface ApplyResult {
  workflowId: string;
  versionId: string;
  createdStepIds: string[];
  placeholderToRealId: Record<string, string>;
}

/**
 * Apply an approved BuildPlan: create new custom steps, rewrite the graph to
 * reference their real ids, then create the workflow as a draft. On any failure
 * after steps were created, delete them (newest first) and rethrow. Never
 * publishes or runs.
 */
export async function applyBuildPlan(deps: ApplyDeps, args: ApplyArgs): Promise<ApplyResult> {
  const { plan } = args;
  const createdStepIds: string[] = [];
  const placeholderToRealId: Record<string, string> = {};

  try {
    // 1. Create each new custom step, capturing placeholder → real id.
    for (const proposed of plan.newCustomSteps) {
      const stepUserId = proposed.step.scope === "user" ? args.userId : null;
      if (args.orgId === null) {
        throw new Error("orgId is required to create custom steps");
      }
      const created = await deps.insertStep({
        ...proposed.step,
        orgId: args.orgId,
        userId: stepUserId,
        createdBy: args.createdBy ?? "",
      });
      createdStepIds.push(created.id);
      placeholderToRealId[proposed.id] = created.id;
    }

    // 2. Rewrite the graph to reference the real ids.
    const definition = rewriteCustomStepIds(plan.workflow, placeholderToRealId);

    // 3. Create the draft workflow (draft is the DB default — never publish).
    const ownerUserId = args.scope === "user" ? args.userId : null;
    const orgId = args.scope === "global" ? null : args.orgId;
    const { workflowId, versionId } = await deps.createWorkflow({
      scope: args.scope,
      name: args.workflowName,
      orgId,
      ownerUserId,
      initialDefinition: definition,
      createdByUserId: args.createdBy,
    });

    return { workflowId, versionId, createdStepIds, placeholderToRealId };
  } catch (err) {
    // Rollback created steps, newest first; swallow rollback errors so the
    // original failure is what surfaces.
    for (const id of [...createdStepIds].reverse()) {
      try { await deps.deleteStep(id); } catch { /* best-effort rollback */ }
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/builder/src/apply/apply.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Export the executor from `packages/builder/src/index.ts`**

Add to the existing barrel:

```ts
export { applyBuildPlan, type ApplyDeps, type ApplyArgs, type ApplyResult } from "./apply/apply.ts";
export { rewriteCustomStepIds } from "./apply/rewrite.ts";
```

- [ ] **Step 6: Run the whole builder package's tests**

Run: `npm test -w @journeyman/builder`
Expected: PASS — all prior tests (Phase 1 store + Phase 2a assembler) plus the two new apply test files.

---

## Final: Typecheck the whole repo (no commit)

- [ ] **Step 1: Run the full type + import-boundary check**

Run: `npm run check`
Expected: PASS — `npm run typecheck` (all workspaces incl. `@journeyman/builder`) and `npm run check:boundaries` (clean). **Do not commit** — leave changes for review.

---

## Self-review checklist (run before handoff)

- **Spec coverage (Phase 2b slice):** graph rewrite (placeholder → real custom-step id) ✓ (Task 1); ordered create → rewrite → draft create → rollback, never publish ✓ (Task 2); scope-derived `orgId`/`ownerUserId` and per-step `userId` ✓ (Task 2). Re-validation is the API caller's job (Phase 3); branching is Phase 2c.
- **No placeholders:** every code step has complete code; every run step has a command + expected result.
- **Type consistency:** `ApplyDeps`/`ApplyArgs`/`ApplyResult` defined once and used by the test; `CreateWorkflowArgs`/`WorkflowScope`/`CustomAiStepCreateInput`/`BuildPlan` imported from core; `rewriteCustomStepIds` signature matches between Task 1 and its use in Task 2.
- **Decoupling:** the executor imports no `pg` and no orchestrator — only core types + the local rewrite helper. Real effects are injected, so the unit tests need no DB.
- **No commit steps anywhere; final step is `npm run check`.** ✓

> **Phase 2c (next):** conditional branching — extend the intent with an explicit branch/edge model, emit `gateway-xor` nodes + `conditional`/`else` edges (`branchLabel` unique, `condition` JsonLogic with `var` paths `<nodeId>.output.<rest>` / `workflow.input.<rest>`), per the verified `emitSwitch` encoding.
