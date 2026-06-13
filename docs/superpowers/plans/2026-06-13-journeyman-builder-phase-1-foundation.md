# Journeyman Builder — Phase 1: Foundation & Contracts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational contracts for the Journeyman Builder — the `BuildPlan`/`Gap` types, an availability registry (what's *really* runnable), an extension to `/workflows/validate` that accepts not-yet-created steps, and a persisted builder-session store — with no agent/LLM and no UI yet.

**Architecture:** A new `@journeyman/builder` backend package holds the session store and its CRUD routes. Shared contract types and the availability registry go in `@journeyman/core`. The existing `POST /workflows/validate` route gains an optional `proposedCustomSteps` field so a plan containing brand-new steps can pass the *same* validation gate before Apply. DB logic uses the repo's `Queryable` seam so it's unit-testable without a live Postgres.

**Tech Stack:** TypeScript (ESM, explicit `.ts` import extensions), Fastify routes, `pg` (raw SQL, no ORM), Vitest (`npx vitest run <file>`), append-only SQL migrations.

**Constraints (from the user):** This plan contains **no `git commit` steps**. The **final step is a typecheck** (`npm run check`). Each task ends by running its own tests.

**Scope note:** This is Phase 1 of four (Foundation → Deterministic core → Agent → Web page). It produces working, testable software on its own: types compile, the availability helpers work, `/workflows/validate` accepts proposed steps, and the session store CRUD is verified.

**Reference:** Design spec `docs/superpowers/specs/2026-06-13-journeyman-builder-design.md`; deferred items `docs/superpowers/specs/journeyman-builder-future-todo.md`.

---

## File Structure (Phase 1)

**Create:**
- `packages/builder/package.json` — new backend package manifest
- `packages/builder/tsconfig.json` — TS config (mirrors siblings)
- `packages/builder/src/index.ts` — package barrel
- `packages/builder/src/types.ts` — `BuilderSessionRecord` + input types
- `packages/builder/src/db.ts` — `Queryable` seam + session-store CRUD
- `packages/builder/src/db.test.ts` — CRUD unit tests (fake `Queryable`)
- `packages/builder/src/routes/sessions.ts` — user-scoped session CRUD routes
- `packages/builder/src/routes/index.ts` — route aggregator
- `packages/core/src/types/builder.types.ts` — `BuildPlan` / `StepBinding` / `Gap` / `ProposedCustomStep`
- `packages/core/src/types/builder.types.test.ts` — shape smoke test
- `packages/core/src/registries/builder-availability.ts` — supported node types + unsupported-operations deny-list
- `packages/core/src/registries/builder-availability.test.ts` — availability helper tests
- `packages/api-server/src/routes/proposed-custom-steps.ts` — proposed-step → shape helper
- `packages/api-server/src/routes/proposed-custom-steps.test.ts` — helper test
- `packages/migrations/src/sql/043_builder_sessions.sql` — session table migration

**Modify:**
- `packages/core/src/index.ts` — export the two new core modules
- `packages/api-server/src/routes/flows.ts` — extend the validate route with `proposedCustomSteps`
- `packages/api-server/src/server.ts` — register builder routes
- `packages/api-server/package.json` — depend on `@journeyman/builder`

---

## Task 0: Scaffold the `@journeyman/builder` package

**Files:**
- Create: `packages/builder/package.json`
- Create: `packages/builder/tsconfig.json`
- Create: `packages/builder/src/index.ts`

- [ ] **Step 1: Create `packages/builder/package.json`**

```json
{
  "name": "@journeyman/builder",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@journeyman/core": "*",
    "@journeyman/custom-steps": "*",
    "@journeyman/identity": "*",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "@types/pg": "^8.11.10",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 2: Create `packages/builder/tsconfig.json`** (identical to `packages/mcp/tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create a placeholder `packages/builder/src/index.ts`** (filled in by later tasks)

```ts
// @journeyman/builder — conversational workflow builder (backend).
// Exports are added as Phase 1 tasks land.
export {};
```

- [ ] **Step 4: Link the new workspace package**

Run: `npm install`
Expected: completes without error; `node_modules/@journeyman/builder` symlink is created. (This also installs `vitest` for the new package.)

- [ ] **Step 5: Verify the empty package typechecks**

Run: `npm run typecheck -w @journeyman/builder`
Expected: PASS (no errors).

---

## Task 1: Core contract types (`BuildPlan`, `StepBinding`, `Gap`, `ProposedCustomStep`)

**Files:**
- Create: `packages/core/src/types/builder.types.ts`
- Test: `packages/core/src/types/builder.types.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/types/builder.types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { BuildPlan, StepBinding, Gap, ProposedCustomStep } from "./builder.types.ts";

describe("builder.types", () => {
  it("a BuildPlan object satisfies the contract", () => {
    const proposed: ProposedCustomStep = {
      id: "tmp-1",
      step: { scope: "user", name: "Security review" },
    };
    const binding: StepBinding = {
      nodeId: "n1",
      stepKind: "ai",
      uses: { tools: ["read-file", "search"], model: "claude-opus" },
      io: { inputs: [{ name: "diff", from: "step 2 · output diff" }], outputs: [{ name: "findings", type: "json" }] },
    };
    const gap: Gap = {
      id: "g1", kind: "not-implemented", nodeIds: ["n4"],
      reason: "Slack send is not implemented yet.", required: true, fixHint: null,
    };
    const plan: BuildPlan = {
      newCustomSteps: [proposed],
      workflow: { schemaVersion: 2, nodes: [], edges: [] },
      defaults: { sandboxId: null, model: null },
      stepBindings: [binding],
      gaps: [gap],
      summary: "Reviews PRs for security and comments.",
    };
    expect(plan.summary).toContain("security");
    expect(plan.newCustomSteps[0].id).toBe("tmp-1");
    expect(plan.stepBindings[0].stepKind).toBe("ai");
    expect(plan.gaps[0].kind).toBe("not-implemented");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/core/src/types/builder.types.test.ts`
Expected: FAIL — cannot resolve `./builder.types.ts` (module not found).

- [ ] **Step 3: Create `packages/core/src/types/builder.types.ts`**

```ts
import type { CustomAiStepCreateInput } from "./custom-steps.types.ts";
import type { CanonicalTool } from "./coding-tools.types.ts";
import type { WorkflowGraph } from "./flow.types.ts";

/** A custom step the Builder proposes to create. `id` is the placeholder the
 *  workflow's nodes reference (config.customStepId) until Apply assigns a real id. */
export interface ProposedCustomStep {
  id: string;
  step: CustomAiStepCreateInput;
}

export type StepKind = "trigger" | "ai" | "provider" | "human-task" | "webhook-wait";

/** Per-node "what this step uses", surfaced in the preview. */
export interface StepBinding {
  nodeId: string;
  stepKind: StepKind;
  uses: {
    tools?: CanonicalTool[];
    mcpIds?: string[];
    skillIds?: string[];
    model?: string;
    connection?: string;
    sandboxId?: string;
    /** Secret slots tagged by name (convention) — values never carried in the plan. */
    secrets?: { slot: string; secretName: string | null }[];
  };
  io: {
    inputs: { name: string; from: string }[];
    outputs: { name: string; type: string }[];
  };
}

export type GapKind =
  | "mcp" | "skill" | "sandbox" | "connection" | "webhook"
  | "capability"        // no catalog step covers the action
  | "not-implemented";  // a needed provider/operation/node exists in name but is a stub

export interface Gap {
  id: string;
  kind: GapKind;
  /** The step(s) this blocks — a gap can span steps. */
  nodeIds: string[];
  reason: string;
  required: boolean;
  /** Pointer to the existing config UI; null for capability gaps. */
  fixHint: string | null;
}

export interface BuildPlan {
  newCustomSteps: ProposedCustomStep[];
  workflow: WorkflowGraph;
  defaults: { sandboxId: string | null; model: string | null };
  stepBindings: StepBinding[];
  gaps: Gap[];
  summary: string;
}
```

- [ ] **Step 4: Export the new types from `packages/core/src/index.ts`**

Add this line alongside the other `export type * from "./types/..."` lines (e.g. just after the `custom-steps.types.ts` export block near line 17):

```ts
export type * from "./types/builder.types.ts";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/core/src/types/builder.types.test.ts`
Expected: PASS (1 test).

---

## Task 2: Availability registry (`builder-availability.ts`)

**Files:**
- Create: `packages/core/src/registries/builder-availability.ts`
- Test: `packages/core/src/registries/builder-availability.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/registries/builder-availability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  isNodeTypeSupported,
  listSupportedNodeTypes,
  unsupportedOperationForStep,
  UNSUPPORTED_OPERATIONS,
} from "./builder-availability.ts";

describe("builder-availability — node types", () => {
  it("loops, branching, timers and waits ARE supported", () => {
    for (const t of ["loop", "if", "gateway-xor", "timer", "human-task", "webhook-wait"] as const) {
      expect(isNodeTypeSupported(t)).toBe(true);
    }
  });
  it("retry-block and try-catch are NOT supported", () => {
    expect(isNodeTypeSupported("retry-block")).toBe(false);
    expect(isNodeTypeSupported("try-catch")).toBe(false);
  });
  it("listSupportedNodeTypes excludes the two unsupported types", () => {
    const list = listSupportedNodeTypes();
    expect(list).not.toContain("retry-block");
    expect(list).not.toContain("try-catch");
    expect(list).toContain("loop");
  });
});

describe("builder-availability — unsupported operations", () => {
  it("flags Jira transition and comment as unsupported by their step types", () => {
    expect(unsupportedOperationForStep("jira", "transition-issue")).toBeDefined();
    expect(unsupportedOperationForStep("jira", "comment-on-issue")).toBeDefined();
  });
  it("returns undefined for a supported operation", () => {
    expect(unsupportedOperationForStep("github", "open-pull-request")).toBeUndefined();
  });
  it("every entry names the provider, method and at least one step type", () => {
    for (const op of UNSUPPORTED_OPERATIONS) {
      expect(op.provider).toBeTruthy();
      expect(op.method).toBeTruthy();
      expect(op.stepTypes.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/core/src/registries/builder-availability.test.ts`
Expected: FAIL — cannot resolve `./builder-availability.ts`.

- [ ] **Step 3: Create `packages/core/src/registries/builder-availability.ts`**

```ts
import type { WorkflowNodeType } from "../types/flow.types.ts";

/**
 * Node types the Conductor converter actually implements (see
 * `conductor-converter.ts` `emitNode`). Authoritative over the stale
 * "reserved/not-yet-supported" comment in `flow.types.ts`.
 * Only `retry-block` and `try-catch` are NOT supported.
 */
export const SUPPORTED_NODE_TYPES: ReadonlySet<WorkflowNodeType> = new Set<WorkflowNodeType>([
  "trigger-manual",
  "trigger-webhook",
  "trigger-human",
  "end",
  "step",
  "human-task",
  "webhook-wait",
  "gateway-xor",
  "gateway-and",
  "join",
  "loop",
  "subflow",
  "if",
  "timer",
]);

export function isNodeTypeSupported(t: WorkflowNodeType): boolean {
  return SUPPORTED_NODE_TYPES.has(t);
}

export function listSupportedNodeTypes(): WorkflowNodeType[] {
  return [...SUPPORTED_NODE_TYPES];
}

/**
 * A specific provider operation that exists in name but throws at runtime,
 * even though the provider's `implemented` flag is `true`. The Builder consults
 * this deny-list in addition to the per-provider flag so it never proposes a
 * step that validates but fails when run.
 */
export interface UnsupportedOperation {
  /** provider-catalog `value`, e.g. "jira". */
  provider: string;
  /** the interface method that throws, e.g. "transitionIssue". */
  method: string;
  /** catalog step types that invoke this operation. */
  stepTypes: string[];
  /** plain-language reason, used in the gap message. */
  reason: string;
}

export const UNSUPPORTED_OPERATIONS: ReadonlyArray<UnsupportedOperation> = [
  {
    provider: "jira",
    method: "transitionIssue",
    stepTypes: ["transition-issue"],
    reason: "JiraProvider.updateStatus is not implemented yet.",
  },
  {
    provider: "jira",
    method: "commentOnIssue",
    stepTypes: ["comment-on-issue"],
    reason: "JiraProvider.addComment is not implemented yet.",
  },
];

/** Returns the unsupported-operation entry for a (provider, stepType) pair, if any. */
export function unsupportedOperationForStep(
  provider: string,
  stepType: string,
): UnsupportedOperation | undefined {
  return UNSUPPORTED_OPERATIONS.find(
    (o) => o.provider === provider && o.stepTypes.includes(stepType),
  );
}
```

- [ ] **Step 4: Export the registry from `packages/core/src/index.ts`**

This module has runtime values (consts + functions), so use a plain `export *`. Add alongside the other registry/value exports:

```ts
export * from "./registries/builder-availability.ts";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/core/src/registries/builder-availability.test.ts`
Expected: PASS (5 tests).

---

## Task 3: Extend `/workflows/validate` with `proposedCustomSteps`

**Files:**
- Create: `packages/api-server/src/routes/proposed-custom-steps.ts`
- Test: `packages/api-server/src/routes/proposed-custom-steps.test.ts`
- Modify: `packages/api-server/src/routes/flows.ts`

- [ ] **Step 1: Write the failing test for the pure helper**

Create `packages/api-server/src/routes/proposed-custom-steps.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shapesFromProposedSteps } from "./proposed-custom-steps.ts";
import type { ProposedCustomStep } from "@journeyman/core";

describe("shapesFromProposedSteps", () => {
  it("returns an empty map for undefined", () => {
    expect(shapesFromProposedSteps(undefined).size).toBe(0);
  });

  it("builds a shape keyed by the placeholder id, with declared input fields", () => {
    const proposed: ProposedCustomStep[] = [
      {
        id: "tmp-sec",
        step: {
          scope: "user",
          name: "Security review",
          inputFields: [{ name: "diff", type: "string", required: true }],
          outputMode: "structured",
          outputFields: [{ name: "findings", type: "json-array", required: true }],
        },
      },
    ];
    const map = shapesFromProposedSteps(proposed);
    expect(map.has("tmp-sec")).toBe(true);
    expect(map.get("tmp-sec")!.inputFields).toHaveProperty("diff");
    expect(map.get("tmp-sec")!.outputSchema).not.toBeNull();
  });

  it("defaults missing inputFields/outputMode safely", () => {
    const map = shapesFromProposedSteps([{ id: "x", step: { scope: "user", name: "Bare" } }]);
    expect(map.has("x")).toBe(true);
    expect(map.get("x")!.outputSchema).toBeNull(); // outputMode defaults to "none"
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/api-server/src/routes/proposed-custom-steps.test.ts`
Expected: FAIL — cannot resolve `./proposed-custom-steps.ts`.

- [ ] **Step 3: Create `packages/api-server/src/routes/proposed-custom-steps.ts`**

This reuses the real `customStepToShape` mapping by synthesizing the minimal object it reads (`inputFields`, `outputMode`, `outputFields`), so it does not duplicate the field-mapping logic.

```ts
import type { CustomAiStep, ProposedCustomStep } from "@journeyman/core";
import { customStepToShape, type CustomStepShape } from "@journeyman/custom-steps/shape-adapter";

/**
 * Build `CustomStepShape` entries for not-yet-persisted proposed steps, keyed by
 * their placeholder id (the value workflow nodes carry in `config.customStepId`).
 * Lets the validate gate resolve refs to brand-new steps before they exist in the DB.
 */
export function shapesFromProposedSteps(
  proposed: ProposedCustomStep[] | undefined,
): Map<string, CustomStepShape> {
  const map = new Map<string, CustomStepShape>();
  if (!proposed) return map;
  for (const p of proposed) {
    // customStepToShape only reads inputFields / outputMode / outputFields.
    const shape = customStepToShape({
      inputFields: p.step.inputFields ?? [],
      outputMode: p.step.outputMode ?? "none",
      outputFields: p.step.outputFields ?? [],
    } as unknown as CustomAiStep);
    map.set(p.id, shape);
  }
  return map;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/api-server/src/routes/proposed-custom-steps.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire `proposedCustomSteps` into the validate route**

In `packages/api-server/src/routes/flows.ts`:

(a) Add the import for the helper and the type. Near the existing `import { getCustomAiStep } from "@journeyman/custom-steps";` (line ~19) add:

```ts
import { shapesFromProposedSteps } from "./proposed-custom-steps.ts";
import type { ProposedCustomStep } from "@journeyman/core";
```

(b) Change `loadCustomStepShapes` (lines ~326–344) to accept and merge proposed steps:

```ts
async function loadCustomStepShapes(
  c: Composition,
  graph: WorkflowGraph,
  proposed?: ProposedCustomStep[],
): Promise<Map<string, CustomStepShape>> {
  const map = new Map<string, CustomStepShape>();
  if (c.pool) {
    const ids = new Set<string>();
    for (const n of graph.nodes) {
      if (n.type === "step" && n.stepType === "custom-ai") {
        const id = (n.config as { customStepId?: unknown } | undefined)?.customStepId;
        if (typeof id === "string" && id) ids.add(id);
      }
    }
    for (const id of ids) {
      const step = await getCustomAiStep(c.pool, id);
      if (step) map.set(id, customStepToShape(step));
    }
  }
  // Merge not-yet-persisted proposed steps (no DB write); they fill their placeholder ids.
  for (const [id, shape] of shapesFromProposedSteps(proposed)) map.set(id, shape);
  return map;
}
```

(c) Widen the validate route's request body type (line ~372) and pass proposals at both `loadCustomStepShapes` call sites (lines ~377 and ~425):

```ts
const body = req.body as { definition?: WorkflowGraph; proposedCustomSteps?: ProposedCustomStep[] };
```
```ts
const customStepShapes = await loadCustomStepShapes(c, body.definition, body.proposedCustomSteps);
```
```ts
const customStepDefs = await loadCustomStepShapes(c, body.definition, body.proposedCustomSteps);
```

- [ ] **Step 6: Re-run the helper test and typecheck the api-server package**

Run: `npx vitest run packages/api-server/src/routes/proposed-custom-steps.test.ts`
Expected: PASS.

Run: `npm run typecheck -w @journeyman/api-server`
Expected: PASS — confirms the route wiring is type-correct. (The route is integration-tested in Phase 3 once the agent produces real plans; there is no live-Postgres unit harness in this repo, so the unit-level guarantee here is the helper test + typecheck.)

---

## Task 4: Session table, store, and CRUD routes

**Files:**
- Create: `packages/migrations/src/sql/043_builder_sessions.sql`
- Create: `packages/builder/src/types.ts`
- Create: `packages/builder/src/db.ts`
- Test: `packages/builder/src/db.test.ts`
- Create: `packages/builder/src/routes/sessions.ts`
- Create: `packages/builder/src/routes/index.ts`
- Modify: `packages/builder/src/index.ts`
- Modify: `packages/api-server/src/server.ts`
- Modify: `packages/api-server/package.json`

- [ ] **Step 1: Create the migration `packages/migrations/src/sql/043_builder_sessions.sql`**

```sql
-- 043_builder_sessions.sql
-- User/org-scoped conversational AI-builder chat sessions: the message
-- transcript and the latest build plan, so a build can be left and resumed.

CREATE TABLE IF NOT EXISTS jm_builder_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES jm_orgs(id)  ON DELETE CASCADE,
  user_id         UUID          REFERENCES jm_users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'applied', 'archived')),
  messages        JSONB NOT NULL DEFAULT '[]'::jsonb,
  build_plan      JSONB,
  applied_flow_id UUID,
  created_by      UUID NOT NULL REFERENCES jm_users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_builder_sessions_scope_name_unique
    UNIQUE NULLS NOT DISTINCT (org_id, user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_jm_builder_sessions_org_user
  ON jm_builder_sessions (org_id, user_id);
```

- [ ] **Step 2: Create `packages/builder/src/types.ts`**

```ts
import type { BuildPlan } from "@journeyman/core";

export type BuilderSessionStatus = "active" | "applied" | "archived";

export interface BuilderSessionRecord {
  id: string;
  orgId: string;
  userId: string | null;
  name: string;
  status: BuilderSessionStatus;
  messages: unknown[];
  buildPlan: BuildPlan | null;
  appliedFlowId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBuilderSessionInput {
  orgId: string;
  userId: string | null;
  name: string;
  createdBy: string;
  messages?: unknown[];
  buildPlan?: BuildPlan | null;
}

export interface UpdateBuilderSessionInput {
  id: string;
  orgId: string;
  userId: string | null;
  name?: string;
  status?: BuilderSessionStatus;
  messages?: unknown[];
  buildPlan?: BuildPlan | null;
  appliedFlowId?: string | null;
}
```

- [ ] **Step 3: Write the failing test for the store**

Create `packages/builder/src/db.test.ts`. It uses a programmable fake `Queryable` (the repo's DB test seam) that records calls and can simulate a unique-constraint violation.

```ts
import { describe, it, expect } from "vitest";
import type { Queryable } from "./db.ts";
import {
  insertBuilderSession,
  listBuilderSessions,
  getBuilderSession,
  updateBuilderSession,
  deleteBuilderSession,
} from "./db.ts";

type Call = { text: string; params?: unknown[] };

/** Fake Queryable. `responder` returns rows (or throws) per call index. */
function fakeDb(responder: (call: Call, i: number) => { rows: any[] }) {
  const calls: Call[] = [];
  const db: Queryable & { calls: Call[] } = {
    calls,
    async query(text: string, params?: unknown[]) {
      const call = { text, params };
      const i = calls.length;
      calls.push(call);
      return responder(call, i);
    },
  };
  return db;
}

const ROW = {
  id: "s1", org_id: "o1", user_id: "u1", name: "PR security review",
  status: "active", messages: [], build_plan: null, applied_flow_id: null,
  created_by: "u1", created_at: "2026-06-13T00:00:00Z", updated_at: "2026-06-13T00:00:00Z",
};

describe("builder session store", () => {
  it("insert maps row→record and sends the right columns", async () => {
    const db = fakeDb(() => ({ rows: [ROW] }));
    const rec = await insertBuilderSession(db, {
      orgId: "o1", userId: "u1", name: "PR security review", createdBy: "u1",
    });
    expect(rec.id).toBe("s1");
    expect(rec.name).toBe("PR security review");
    expect(db.calls[0].text).toMatch(/insert into jm_builder_sessions/i);
    expect(db.calls[0].params).toEqual([
      "o1", "u1", "PR security review", "[]", null, "u1",
    ]);
  });

  it("insert suffixes the name on a unique-constraint collision", async () => {
    const db = fakeDb((_call, i) => {
      if (i === 0) { const e: any = new Error("dup"); e.code = "23505"; throw e; }
      return { rows: [{ ...ROW, name: "PR security review (2)" }] };
    });
    const rec = await insertBuilderSession(db, {
      orgId: "o1", userId: "u1", name: "PR security review", createdBy: "u1",
    });
    expect(rec.name).toBe("PR security review (2)");
    expect(db.calls).toHaveLength(2);
    expect(db.calls[1].params?.[2]).toBe("PR security review (2)");
  });

  it("list scopes by org + user and orders by updated_at desc", async () => {
    const db = fakeDb(() => ({ rows: [ROW] }));
    const rows = await listBuilderSessions(db, "o1", "u1");
    expect(rows).toHaveLength(1);
    expect(db.calls[0].text).toMatch(/where org_id = \$1 and user_id = \$2/i);
    expect(db.calls[0].text).toMatch(/order by updated_at desc/i);
    expect(db.calls[0].params).toEqual(["o1", "u1"]);
  });

  it("get returns null when no row", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    const rec = await getBuilderSession(db, "missing", "o1", "u1");
    expect(rec).toBeNull();
  });

  it("update builds a dynamic SET clause and appends updated_at = now()", async () => {
    const db = fakeDb(() => ({ rows: [{ ...ROW, status: "applied" }] }));
    const ok = await updateBuilderSession(db, {
      id: "s1", orgId: "o1", userId: "u1", status: "applied", appliedFlowId: "f1",
    });
    expect(ok).toBe(true);
    expect(db.calls[0].text).toMatch(/update jm_builder_sessions set/i);
    expect(db.calls[0].text).toMatch(/updated_at = now\(\)/i);
    expect(db.calls[0].text).toMatch(/status = \$/);
    expect(db.calls[0].text).toMatch(/applied_flow_id = \$/);
  });

  it("delete returns false when nothing was removed", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    const ok = await deleteBuilderSession(db, "s1", "o1", "u1");
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/db.test.ts`
Expected: FAIL — cannot resolve `./db.ts`.

- [ ] **Step 5: Create `packages/builder/src/db.ts`**

Note: `delete`/`update` return a boolean from `rowCount`. The fake returns `{ rows }` only, so `rowCount` is `undefined` → `(undefined ?? 0) > 0` is governed by `rows.length` instead; we therefore derive success from `rows.length` for `update`/`delete` so the store is testable through the `Queryable` seam (which exposes `rows`, not `rowCount`).

```ts
import type {
  BuilderSessionRecord,
  CreateBuilderSessionInput,
  UpdateBuilderSessionInput,
} from "./types.ts";

/** Minimal structural seam over a pg Pool/Client so the store is unit-testable. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number }>;
}

const MAX_NAME_ATTEMPTS = 50;

function rowToRecord(r: any): BuilderSessionRecord {
  return {
    id: r.id,
    orgId: r.org_id,
    userId: r.user_id,
    name: r.name,
    status: r.status,
    messages: r.messages ?? [],
    buildPlan: r.build_plan ?? null,
    appliedFlowId: r.applied_flow_id ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function userClauseAndParams(prefix: unknown[], userId: string | null): { clause: string; params: unknown[] } {
  if (userId === null) return { clause: "AND user_id IS NULL", params: prefix };
  return { clause: `AND user_id = $${prefix.length + 1}`, params: [...prefix, userId] };
}

/**
 * Insert a session. On a unique-(org,user,name) collision, retry with a
 * " (N)" suffix rather than failing (the design's de-dup-on-collision rule).
 */
export async function insertBuilderSession(
  db: Queryable,
  input: CreateBuilderSessionInput,
): Promise<BuilderSessionRecord> {
  const messages = JSON.stringify(input.messages ?? []);
  const buildPlan = input.buildPlan == null ? null : JSON.stringify(input.buildPlan);
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
    const name = attempt === 1 ? input.name : `${input.name} (${attempt})`;
    try {
      const r = await db.query(
        `INSERT INTO jm_builder_sessions
           (org_id, user_id, name, messages, build_plan, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [input.orgId, input.userId, name, messages, buildPlan, input.createdBy],
      );
      return rowToRecord(r.rows[0]);
    } catch (err: any) {
      if (err?.code === "23505" && attempt < MAX_NAME_ATTEMPTS) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a unique builder session name");
}

export async function listBuilderSessions(
  db: Queryable,
  orgId: string,
  userId: string | null,
): Promise<BuilderSessionRecord[]> {
  const { clause, params } = userClauseAndParams([orgId], userId);
  const r = await db.query(
    `SELECT * FROM jm_builder_sessions WHERE org_id = $1 ${clause} ORDER BY updated_at DESC`,
    params,
  );
  return r.rows.map(rowToRecord);
}

export async function getBuilderSession(
  db: Queryable,
  id: string,
  orgId: string,
  userId: string | null,
): Promise<BuilderSessionRecord | null> {
  const { clause, params } = userClauseAndParams([id, orgId], userId);
  const r = await db.query(
    `SELECT * FROM jm_builder_sessions WHERE id = $1 AND org_id = $2 ${clause}`,
    params,
  );
  return r.rows[0] ? rowToRecord(r.rows[0]) : null;
}

export async function updateBuilderSession(
  db: Queryable,
  input: UpdateBuilderSessionInput,
): Promise<boolean> {
  const { clause, params: scopeParams } = userClauseAndParams([input.id, input.orgId], input.userId);
  const sets: string[] = [];
  const params: unknown[] = [...scopeParams];
  const push = (col: string, value: unknown) => {
    sets.push(`${col} = $${params.length + 1}`);
    params.push(value);
  };
  if (input.name !== undefined) push("name", input.name);
  if (input.status !== undefined) push("status", input.status);
  if (input.messages !== undefined) push("messages", JSON.stringify(input.messages));
  if (input.buildPlan !== undefined) push("build_plan", input.buildPlan == null ? null : JSON.stringify(input.buildPlan));
  if (input.appliedFlowId !== undefined) push("applied_flow_id", input.appliedFlowId);
  if (sets.length === 0) return true;
  sets.push("updated_at = now()");
  const r = await db.query(
    `UPDATE jm_builder_sessions SET ${sets.join(", ")}
      WHERE id = $1 AND org_id = $2 ${clause}
      RETURNING id`,
    params,
  );
  return r.rows.length > 0;
}

export async function deleteBuilderSession(
  db: Queryable,
  id: string,
  orgId: string,
  userId: string | null,
): Promise<boolean> {
  const { clause, params } = userClauseAndParams([id, orgId], userId);
  const r = await db.query(
    `DELETE FROM jm_builder_sessions WHERE id = $1 AND org_id = $2 ${clause} RETURNING id`,
    params,
  );
  return r.rows.length > 0;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run packages/builder/src/db.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Create the route module `packages/builder/src/routes/sessions.ts`**

Mirrors `packages/mcp/src/routes/user-mcp.ts` exactly (auth, `:orgId` guard, status codes). `req.runContext!` provides `ctx.user.id` and `ctx.org.id`.

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  insertBuilderSession,
  listBuilderSessions,
  getBuilderSession,
  updateBuilderSession,
  deleteBuilderSession,
} from "../db.ts";

export async function registerBuilderSessionRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/users/me/builder/sessions",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listBuilderSessions(pool, orgId, ctx.user.id);
    });

  app.post("/api/orgs/:orgId/users/me/builder/sessions",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { name?: string; messages?: unknown[]; buildPlan?: unknown };
      if (!body?.name || typeof body.name !== "string") {
        return reply.code(400).send({ error: "name is required" });
      }
      const rec = await insertBuilderSession(pool, {
        orgId,
        userId: ctx.user.id,
        name: body.name,
        createdBy: ctx.user.id,
        messages: body.messages ?? [],
        buildPlan: (body.buildPlan as never) ?? null,
      });
      reply.code(201);
      return rec;
    });

  app.get("/api/orgs/:orgId/users/me/builder/sessions/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rec = await getBuilderSession(pool, id, orgId, ctx.user.id);
      if (!rec) return reply.code(404).send({ error: "Not found" });
      return rec;
    });

  app.patch("/api/orgs/:orgId/users/me/builder/sessions/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as {
        name?: string; status?: "active" | "applied" | "archived";
        messages?: unknown[]; buildPlan?: unknown; appliedFlowId?: string | null;
      };
      const ok = await updateBuilderSession(pool, {
        id, orgId, userId: ctx.user.id,
        name: body.name,
        status: body.status,
        messages: body.messages,
        buildPlan: body.buildPlan as never,
        appliedFlowId: body.appliedFlowId,
      });
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });

  app.delete("/api/orgs/:orgId/users/me/builder/sessions/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const ok = await deleteBuilderSession(pool, id, orgId, ctx.user.id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });
}
```

- [ ] **Step 8: Create the aggregator `packages/builder/src/routes/index.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerBuilderSessionRoutes } from "./sessions.ts";

export async function registerBuilderRoutes(app: FastifyInstance, pool: Pool) {
  await registerBuilderSessionRoutes(app, pool);
}
```

- [ ] **Step 9: Fill in the package barrel `packages/builder/src/index.ts`**

```ts
// @journeyman/builder — conversational workflow builder (backend).
export { registerBuilderRoutes } from "./routes/index.ts";
export {
  insertBuilderSession,
  listBuilderSessions,
  getBuilderSession,
  updateBuilderSession,
  deleteBuilderSession,
  type Queryable,
} from "./db.ts";
export type {
  BuilderSessionRecord,
  BuilderSessionStatus,
  CreateBuilderSessionInput,
  UpdateBuilderSessionInput,
} from "./types.ts";
```

- [ ] **Step 10: Depend on `@journeyman/builder` from api-server**

In `packages/api-server/package.json`, add to `"dependencies"` (alphabetically near the other `@journeyman/*` entries):

```json
"@journeyman/builder": "*",
```

- [ ] **Step 11: Register the routes in `packages/api-server/src/server.ts`**

Add the import near the other route-package imports (by line ~19):

```ts
import { registerBuilderRoutes } from "@journeyman/builder";
```

Inside `buildServer`, in the `if (c.pool) { ... }` block (alongside `registerMcpRoutes`, ~line 42), add:

```ts
await registerBuilderRoutes(app, c.pool);
```

- [ ] **Step 12: Re-link workspaces (new dependency edge) and re-run the store test**

Run: `npm install`
Expected: completes; `@journeyman/api-server` now resolves `@journeyman/builder`.

Run: `npx vitest run packages/builder/src/db.test.ts`
Expected: PASS (6 tests).

---

## Final: Typecheck the whole repo (no commit)

- [ ] **Step 1: Run the full type + import-boundary check**

Run: `npm run check`
Expected: PASS — `npm run typecheck` (every workspace's `tsc --noEmit`, including the new `@journeyman/builder`) succeeds, then `npm run check:boundaries` reports no violations.

If `typecheck` fails, fix the reported types in the files above and re-run `npm run check`. **Do not commit** — leave the changes staged-or-unstaged for review per the user's instruction.

---

## Self-review checklist (run before handoff)

- **Spec coverage (Phase 1 slice):** `BuildPlan`/`StepBinding`/`Gap` types ✓ (Task 1); availability sources — supported node types + unsupported-operations deny-list ✓ (Task 2); validate-with-`proposedCustomSteps` ✓ (Task 3); migration `043` + session store + CRUD routes + registration ✓ (Task 4). `listProviders` is satisfied by core's existing `implementedProvidersForKind` / `PROVIDER_CATALOG` (no new code needed); `listSupportedNodeTypes` ✓ (Task 2). Agent/assembler/serializers/SSE/page are Phases 2–4 (out of scope here).
- **No placeholders:** every code step contains complete code; every run step has a command + expected result.
- **Type consistency:** `ProposedCustomStep` is defined once (Task 1) and consumed by Task 3; `Queryable` defined in `db.ts` (Task 4) and used by its test; `BuilderSessionRecord` field names match the `rowToRecord` mapper and the migration columns.
- **No commit steps anywhere; final step is `npm run check`.** ✓
