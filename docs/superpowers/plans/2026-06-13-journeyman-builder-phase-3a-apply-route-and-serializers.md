# Journeyman Builder — Phase 3a: Apply Route + Context Serializers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two deterministic, key-free pieces of Phase 3: (1) the **context serializers** (turn the live catalog / providers / node-types / inventory into compact prompt text — pure functions), and (2) the **apply route** (`POST …/builder/sessions/:id/apply`) that takes a session's stored `BuildPlan`, binds the Phase-2b executor to the real DB/store create functions, creates the draft workflow, and marks the session applied.

**Architecture:** Serializers are pure functions in `@journeyman/builder` (`src/agent/serializers.ts`) operating on minimal structural inputs (no heavy imports). The apply route lives in `@journeyman/api-server` (`src/routes/builder-apply.ts`), takes `(app, c: Composition)`, and adapts the real `insertCustomAiStep`/`deleteCustomAiStep`/`c.workflows.create` into the executor's injected `ApplyDeps`. The pure arg-derivation is extracted and unit-tested; the executor itself is already tested (Phase 2b).

**Tech Stack:** TypeScript (ESM, explicit `.ts` extensions), Fastify, `pg`, Vitest.

**Constraints (from the user):** **No `git commit` steps.** **Final step is `npm run check`.** Each task ends by running its tests.

**Reference:** Spec `docs/superpowers/specs/2026-06-13-journeyman-builder-design.md`. Builds on Phase 1 (session store, `getBuilderSession`/`updateBuilderSession`), Phase 2b (`applyBuildPlan`, `ApplyDeps`, `ApplyArgs`).

**Verified contracts:**
- `insertCustomAiStep(pool, input: CustomAiStepCreateInput & { orgId; userId: string|null; createdBy }) → CustomAiStep` (has `.id`); `deleteCustomAiStep(pool, id) → boolean`. Both from `@journeyman/custom-steps`.
- `c.workflows.create(args: CreateWorkflowArgs) → { workflow, version }`; map `{ workflowId: workflow.id, versionId: version.id }`.
- api-server routes take `(app, c: Composition)`, registered in the `/api`-prefixed block in `server.ts`; `requireAuth = makeRequireAuth({ pool: c.pool! })`; `ctx = req.runContext!` → `ctx.user.id` / `ctx.org.id`.
- Builder sessions are **user-scoped** (Phase 1), so applied workflows use `scope: "user"`.

---

## File Structure (Phase 3a)

**Create:**
- `packages/builder/src/agent/serializers.ts` — pure context serializers
- `packages/builder/src/agent/serializers.test.ts`
- `packages/builder/src/apply/apply-args.ts` — pure `buildApplyArgs(session, ctx)` → `ApplyArgs`
- `packages/builder/src/apply/apply-args.test.ts`
- `packages/api-server/src/routes/builder-apply.ts` — the apply route + dep adapter

**Modify:**
- `packages/builder/src/index.ts` — export serializers + `buildApplyArgs`
- `packages/api-server/src/server.ts` — register the apply route

---

## Task 1: Context serializers

**Files:**
- Create: `packages/builder/src/agent/serializers.ts`
- Test: `packages/builder/src/agent/serializers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/builder/src/agent/serializers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  serializeStepCatalog, serializeProviders, serializeNodeTypes, serializeInventory,
} from "./serializers.ts";

describe("serializeStepCatalog", () => {
  it("lists each step with its inputs and outputs", () => {
    const out = serializeStepCatalog([
      { stepType: "get-issue", label: "Get Issue", category: "Issue Tracker", inputs: ["ref"], outputs: ["issue"] },
      { stepType: "custom-ai", label: "Custom AI Step", category: "Custom", inputs: [], outputs: [] },
    ]);
    expect(out).toContain("get-issue");
    expect(out).toContain("Get Issue");
    expect(out).toContain("ref");
    expect(out).toContain("issue");
    expect(out).toContain("custom-ai");
  });
});

describe("serializeProviders", () => {
  it("groups implemented providers by kind", () => {
    const out = serializeProviders([
      { kind: "git-provider", value: "github", label: "GitHub" },
      { kind: "issue-provider", value: "jira", label: "Jira" },
    ]);
    expect(out).toContain("git-provider");
    expect(out).toContain("github");
    expect(out).toContain("jira");
  });
});

describe("serializeNodeTypes", () => {
  it("lists the supported node types", () => {
    expect(serializeNodeTypes(["step", "gateway-xor", "human-task"])).toContain("gateway-xor");
  });
});

describe("serializeInventory", () => {
  it("renders each inventory category, and says 'none' for empty ones", () => {
    const out = serializeInventory({
      customSteps: [{ id: "c1", name: "Security review", description: "Reviews diffs" }],
      mcps: [],
      skills: [{ id: "s1", name: "secure-coding" }],
      sandboxes: [{ id: "sb1", name: "docker-default", type: "docker", tags: ["node"] }],
      webhooks: [{ id: "w1", name: "gh", preset: "github" }],
    });
    expect(out).toContain("Security review");
    expect(out).toContain("secure-coding");
    expect(out).toContain("docker-default");
    expect(out).toContain("gh");
    expect(out.toLowerCase()).toContain("none"); // empty mcps rendered as none
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/agent/serializers.test.ts`
Expected: FAIL — cannot resolve `./serializers.ts`.

- [ ] **Step 3: Create `packages/builder/src/agent/serializers.ts`**

```ts
/** Minimal structural inputs — the api-server maps real records to these. */
export interface CatalogStepSummary {
  stepType: string;
  label: string;
  category: string;
  inputs: string[];
  outputs: string[];
}
export interface ProviderSummary { kind: string; value: string; label: string; }
export interface InventorySummary {
  customSteps: { id: string; name: string; description?: string }[];
  mcps: { id: string; name: string }[];
  skills: { id: string; name: string }[];
  sandboxes: { id: string; name: string; type: string; tags?: string[] }[];
  webhooks: { id: string; name: string; preset?: string }[];
}

/** The built-in step catalog (only step types the assembler may use). */
export function serializeStepCatalog(steps: CatalogStepSummary[]): string {
  const lines = steps.map((s) => {
    const io = `inputs: [${s.inputs.join(", ")}] · outputs: [${s.outputs.join(", ")}]`;
    return `- ${s.stepType} (${s.label}, ${s.category}) — ${io}`;
  });
  return `Available step types:\n${lines.join("\n")}`;
}

/** Implemented providers, grouped by executor kind. */
export function serializeProviders(implemented: ProviderSummary[]): string {
  const byKind = new Map<string, ProviderSummary[]>();
  for (const p of implemented) {
    const arr = byKind.get(p.kind) ?? [];
    arr.push(p);
    byKind.set(p.kind, arr);
  }
  const blocks = [...byKind.entries()].map(([kind, ps]) =>
    `  ${kind}: ${ps.map((p) => `${p.value} (${p.label})`).join(", ")}`,
  );
  return `Implemented providers (only these may be used):\n${blocks.join("\n")}`;
}

/** Node types the engine actually runs. */
export function serializeNodeTypes(types: string[]): string {
  return `Supported node types: ${types.join(", ")}`;
}

/** The user's existing inventory (selectable; anything missing is a gap). */
export function serializeInventory(inv: InventorySummary): string {
  const list = <T>(items: T[], render: (i: T) => string): string =>
    items.length ? items.map((i) => `  - ${render(i)}`).join("\n") : "  (none)";
  return [
    "Your existing custom steps:",
    list(inv.customSteps, (c) => `${c.name}${c.description ? ` — ${c.description}` : ""} [id ${c.id}]`),
    "Your MCP instances:",
    list(inv.mcps, (m) => `${m.name} [id ${m.id}]`),
    "Your skill packages:",
    list(inv.skills, (s) => `${s.name} [id ${s.id}]`),
    "Your sandboxes:",
    list(inv.sandboxes, (s) => `${s.name} (${s.type}${s.tags?.length ? `, tags: ${s.tags.join("/")}` : ""}) [id ${s.id}]`),
    "Your webhooks:",
    list(inv.webhooks, (w) => `${w.name}${w.preset ? ` (${w.preset})` : ""} [id ${w.id}]`),
  ].join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/builder/src/agent/serializers.test.ts`
Expected: PASS (4 tests).

---

## Task 2: `buildApplyArgs` (pure)

**Files:**
- Create: `packages/builder/src/apply/apply-args.ts`
- Test: `packages/builder/src/apply/apply-args.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/builder/src/apply/apply-args.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildApplyArgs, requiredGapsRemaining } from "./apply-args.ts";
import type { BuilderSessionRecord } from "../types.ts";
import type { BuildPlan } from "@journeyman/core";

const plan: BuildPlan = {
  newCustomSteps: [], workflow: { schemaVersion: 2, nodes: [], edges: [] },
  defaults: { sandboxId: null, model: null }, stepBindings: [],
  gaps: [], summary: "s",
};

function session(over: Partial<BuilderSessionRecord> = {}): BuilderSessionRecord {
  return {
    id: "s1", orgId: "o1", userId: "u1", name: "PR review", status: "active",
    messages: [], buildPlan: plan, appliedFlowId: null, createdBy: "u1",
    createdAt: "", updatedAt: "", ...over,
  };
}

describe("buildApplyArgs", () => {
  it("maps a user-scoped session to user-scope ApplyArgs", () => {
    const args = buildApplyArgs(session(), { orgId: "o1", userId: "u1" });
    expect(args).toMatchObject({ workflowName: "PR review", scope: "user", orgId: "o1", userId: "u1", createdBy: "u1" });
    expect(args.plan).toBe(plan);
  });
});

describe("requiredGapsRemaining", () => {
  it("is true when any gap is required", () => {
    expect(requiredGapsRemaining({ ...plan, gaps: [{ id: "g", kind: "webhook", nodeIds: [], reason: "", required: true, fixHint: null }] })).toBe(true);
  });
  it("is false when there are no required gaps", () => {
    expect(requiredGapsRemaining(plan)).toBe(false);
    expect(requiredGapsRemaining({ ...plan, gaps: [{ id: "g", kind: "capability", nodeIds: [], reason: "", required: false, fixHint: null }] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/apply/apply-args.test.ts`
Expected: FAIL — cannot resolve `./apply-args.ts`.

- [ ] **Step 3: Create `packages/builder/src/apply/apply-args.ts`**

```ts
import type { BuildPlan } from "@journeyman/core";
import type { BuilderSessionRecord } from "../types.ts";
import type { ApplyArgs } from "./apply.ts";

/** Derive executor ApplyArgs from a (user-scoped) builder session + auth context. */
export function buildApplyArgs(
  session: BuilderSessionRecord,
  ctx: { orgId: string; userId: string },
): ApplyArgs {
  return {
    plan: session.buildPlan as BuildPlan,
    workflowName: session.name,
    scope: "user",
    orgId: ctx.orgId,
    userId: ctx.userId,
    createdBy: ctx.userId,
  };
}

/** True if the plan still has any required gap (blocks Apply). */
export function requiredGapsRemaining(plan: BuildPlan): boolean {
  return plan.gaps.some((g) => g.required);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/builder/src/apply/apply-args.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Export from `packages/builder/src/index.ts`**

```ts
export {
  serializeStepCatalog, serializeProviders, serializeNodeTypes, serializeInventory,
  type CatalogStepSummary, type ProviderSummary, type InventorySummary,
} from "./agent/serializers.ts";
export { buildApplyArgs, requiredGapsRemaining } from "./apply/apply-args.ts";
```

- [ ] **Step 6: Run the whole builder package's tests**

Run: `npm test -w @journeyman/builder`
Expected: PASS — all prior suites + the two new ones.

---

## Task 3: The apply route

**Files:**
- Create: `packages/api-server/src/routes/builder-apply.ts`
- Modify: `packages/api-server/src/server.ts`

- [ ] **Step 1: Create `packages/api-server/src/routes/builder-apply.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { makeRequireAuth } from "@journeyman/identity";
import { insertCustomAiStep, deleteCustomAiStep } from "@journeyman/custom-steps";
import {
  applyBuildPlan, buildApplyArgs, requiredGapsRemaining,
  getBuilderSession, updateBuilderSession, type ApplyDeps,
} from "@journeyman/builder";
import type { Composition } from "../composition.ts";

/** Build the executor's injected deps from the live composition. */
function makeApplyDeps(c: Composition): ApplyDeps {
  const pool = c.pool!;
  return {
    insertStep: async (input) => {
      const created = await insertCustomAiStep(pool, input);
      return { id: created.id };
    },
    deleteStep: async (id) => { await deleteCustomAiStep(pool, id); },
    createWorkflow: async (args) => {
      const { workflow, version } = await c.workflows.create(args);
      return { workflowId: workflow.id, versionId: version.id };
    },
  };
}

export function registerBuilderApplyRoute(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });

  app.post("/orgs/:orgId/users/me/builder/sessions/:id/apply",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });

      const session = await getBuilderSession(c.pool!, id, orgId, ctx.user.id);
      if (!session) return reply.code(404).send({ error: "Not found" });
      if (!session.buildPlan) return reply.code(400).send({ error: "Session has no build plan to apply" });
      if (requiredGapsRemaining(session.buildPlan)) {
        return reply.code(409).send({ error: "Resolve all required gaps before applying" });
      }

      const args = buildApplyArgs(session, { orgId, userId: ctx.user.id });
      const result = await applyBuildPlan(makeApplyDeps(c), args);

      await updateBuilderSession(c.pool!, {
        id, orgId, userId: ctx.user.id,
        status: "applied", appliedFlowId: result.workflowId,
      });

      reply.code(201);
      return { workflowId: result.workflowId, versionId: result.versionId };
    });
}
```

> Note: paths here have no `/api` prefix because this route is registered inside the existing `app.register(async (s) => {...}, { prefix: "/api" })` block (Step 2), which already prepends `/api`. Final path: `/api/orgs/:orgId/users/me/builder/sessions/:id/apply`.

- [ ] **Step 2: Register the route in `packages/api-server/src/server.ts`**

Add the import near the other route imports (by line ~16):

```ts
import { registerBuilderApplyRoute } from "./routes/builder-apply.ts";
```

Add the registration inside the existing `app.register(async (s) => { ... }, { prefix: "/api" })` block (alongside `registerWorkflowRoutes(s, c)`):

```ts
    registerBuilderApplyRoute(s, c);
```

- [ ] **Step 3: Typecheck the api-server package**

Run: `npm run typecheck -w @journeyman/api-server`
Expected: PASS — confirms the route, the `ApplyDeps` adapter, and the `@journeyman/builder` imports all line up. (The route's runtime behavior depends on a live DB/composition, which has no unit harness in this repo; its logic is covered by the Phase 2b executor tests + the `buildApplyArgs`/`requiredGapsRemaining` unit tests + this typecheck.)

---

## Final: Typecheck the whole repo (no commit)

- [ ] **Step 1: Run the full type + import-boundary check**

Run: `npm run check`
Expected: PASS — `npm run typecheck` (all workspaces) and `npm run check:boundaries` (clean). If boundaries flags `@journeyman/api-server` importing `@journeyman/builder` or `@journeyman/custom-steps`, those are allowed (api-server already depends on both lower-layer packages). **Do not commit** — leave changes for review.

---

## Self-review checklist (run before handoff)

- **Spec coverage (Phase 3a slice):** context serializers (catalog / providers / node-types / inventory → prompt text) ✓ (Task 1); apply route — re-checks required gaps, binds the real create/delete/create-workflow into the executor, creates a draft, marks the session `applied` with `applied_flow_id` ✓ (Tasks 2–3). The LLM agent runner, read-tool *impls*, and the SSE chat route are Phase 3b.
- **No placeholders:** every code step has complete code; every run step has a command + expected result.
- **Type consistency:** `InventorySummary`/`CatalogStepSummary`/`ProviderSummary` defined once (Task 1); `buildApplyArgs` returns the Phase-2b `ApplyArgs`; `makeApplyDeps` returns the Phase-2b `ApplyDeps`; `getBuilderSession`/`updateBuilderSession`/`applyBuildPlan` imported from `@journeyman/builder`.
- **Apply safety:** route blocks on missing plan (400) and on remaining required gaps (409); creates a draft only (executor never publishes); marks the session applied.
- **No commit steps anywhere; final step is `npm run check`.** ✓

> **Phase 3b (next):** the env model factory (`@ai-sdk/*` + `ai`, from `BUILDER_LLM_*`), the read-tool impls (`loadBuilderInventory` over the real stores → `InventorySummary`), the `proposePlan` tool whose params are the `AssemblerIntent` JSON schema, the agent runner (`generateText` with tools + `experimental_output`, then `assemble` → `validatePlan`), and the SSE chat route that persists messages + streams plan updates.
