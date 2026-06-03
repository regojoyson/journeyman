# Rename "worker" (config) → "Compute Target" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behavior-preserving rename of the execution-environment *config* concept from "worker" to "Compute Target" across DB, core types, the package, API routes, web, and flow-editor — while leaving the *engine process* (`WorkerHarness`, `cli-worker.ts`, `WORKER_ID`) named "worker".

**Architecture:** A pure rename. Each task renames **one symbol-cluster repo-wide** so the TypeScript build (`npm run check`) stays green after every task — no temporary aliases needed (renaming a symbol and all its references at once always compiles). New code appears only in two tasks: the DB rename migration, and the load-time `workerId`→`computeTargetId` backward-compat for stored flows.

**Tech Stack:** TypeScript (npm workspaces monorepo), PostgreSQL (raw SQL migrations via `jm_schema_migrations`), vitest, React (web + flow-editor). Gate after every task: `npm run check` (typecheck + import boundaries).

**Spec:** [docs/superpowers/specs/2026-06-02-rename-worker-to-compute-target-design.md](../specs/2026-06-02-rename-worker-to-compute-target-design.md)

**The naming rule (applies to every task):**
- *Config a user creates/selects* → **Compute Target** / `ComputeTarget` / `computeTargetId` / `jm_compute_targets` / `@journeyman/compute`.
- *The running engine that polls Conductor and executes steps* → **unchanged**: `WorkerHarness`, `cli-worker.ts`, `WORKER_ID`, the engine's `workerId`, `WorkflowLogCtx.workerId`, and Conductor's `pollTask(taskType, workerId)`.

**Branch:** work on `feat/rename-compute-target` (create from `master`). Commit after each task; do not push until the user asks.

---

## Task 1: Rename the package `@journeyman/workers` → `@journeyman/compute`

**Files:**
- Move: `packages/workers/` → `packages/compute/` (entire directory, via `git mv`)
- Modify: `packages/compute/package.json` (the `name` field)
- Modify importers: `packages/api-server/package.json`, `packages/api-server/src/composition.ts`, `packages/api-server/src/server.ts`, `packages/orchestrator/package.json`, `packages/orchestrator/src/cli-worker.ts`
- Modify: `scripts/check-import-boundaries.mjs:47`

- [ ] **Step 1: Move the directory**

Run:
```bash
git mv packages/workers packages/compute
```

- [ ] **Step 2: Rename the package and update importers**

Apply these exact string replacements:

| File | Old | New |
|---|---|---|
| `packages/compute/package.json` | `"name": "@journeyman/workers"` | `"name": "@journeyman/compute"` |
| `packages/api-server/package.json` (deps) | `"@journeyman/workers": "*"` | `"@journeyman/compute": "*"` |
| `packages/orchestrator/package.json` (deps) | `"@journeyman/workers": "*"` | `"@journeyman/compute": "*"` |
| `packages/api-server/src/composition.ts` | `from "@journeyman/workers"` | `from "@journeyman/compute"` |
| `packages/api-server/src/server.ts` | `from "@journeyman/workers"` | `from "@journeyman/compute"` |
| `packages/orchestrator/src/cli-worker.ts` | `from "@journeyman/workers"` | `from "@journeyman/compute"` |
| `scripts/check-import-boundaries.mjs:47` | `"@journeyman/workers": "backend",` | `"@journeyman/compute": "backend",` |

(Confirm the exact dependency-version string in each `package.json` — match whatever is there, only the key changes.)

- [ ] **Step 3: Relink the workspace**

Run:
```bash
npm install
```
Expected: completes; `node_modules/@journeyman/compute` symlink now exists.

- [ ] **Step 4: Check for any stray references to the old path/name**

Run:
```bash
grep -rn "@journeyman/workers\|packages/workers" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.mjs" . | grep -v node_modules
```
Expected: no matches. Fix any that appear (e.g. a root tsconfig `references` entry).

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: PASS — typecheck clean, `✓ Layer boundaries clean`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename package @journeyman/workers -> @journeyman/compute"
```

---

## Task 2: Rename core record types (`WorkerRecord` → `ComputeTarget`)

**Files:**
- Move: `packages/core/src/types/worker.types.ts` → `packages/core/src/types/compute-target.types.ts`
- Modify: `packages/core/src/index.ts` (re-exports), and every file referencing these types.

- [ ] **Step 1: Move the types file**

```bash
git mv packages/core/src/types/worker.types.ts packages/core/src/types/compute-target.types.ts
```

- [ ] **Step 2: Apply the symbol renames repo-wide**

Find all references first:
```bash
grep -rn "WorkerRecord\|WorkerScope\|CreateWorkerArgs\|UpdateWorkerArgs\|worker.types" --include="*.ts" --include="*.tsx" packages | grep -v node_modules
```
Then rename, everywhere they appear:

| Old | New |
|---|---|
| `WorkerRecord` | `ComputeTarget` |
| `WorkerScope` | `ComputeTargetScope` |
| `CreateWorkerArgs` | `CreateComputeTargetArgs` |
| `UpdateWorkerArgs` | `UpdateComputeTargetArgs` |
| import path `./types/worker.types.ts` / `worker.types` | `./types/compute-target.types.ts` / `compute-target.types` |

Also update the doc comment in the file: `/** A Worker row as stored in jm_workers. */` → `/** A Compute Target row as stored in jm_compute_targets. */` (the table name itself is renamed in Task 6).

> Note: the `config` field stays `config: Record<string, unknown>` — do not touch its shape (Spec B moves the image later).

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename WorkerRecord -> ComputeTarget core types"
```

---

## Task 3: Rename core execution-target types (`WorkerType` → `ComputeTargetType`)

**Files:**
- Modify: `packages/core/src/types/execution-environment.types.ts`, `packages/core/src/index.ts`
- Move: `packages/compute/src/worker-type-catalog.ts` → `packages/compute/src/compute-target-catalog.ts` (and its `.test.ts`)
- Modify: every referencing file.

- [ ] **Step 1: Find references**

```bash
grep -rn "WorkerType\b\|ResolvedWorker\|WorkerTypeDescriptor\|WORKER_TYPE_CATALOG\|worker-type-catalog" --include="*.ts" --include="*.tsx" packages | grep -v node_modules
```

- [ ] **Step 2: Move the catalog files**

```bash
git mv packages/compute/src/worker-type-catalog.ts packages/compute/src/compute-target-catalog.ts
git mv packages/compute/src/worker-type-catalog.test.ts packages/compute/src/compute-target-catalog.test.ts
```

- [ ] **Step 3: Apply the symbol renames repo-wide**

| Old | New |
|---|---|
| `WorkerType` | `ComputeTargetType` |
| `ResolvedWorker` | `ResolvedComputeTarget` |
| `WorkerTypeDescriptor` | `ComputeTargetTypeDescriptor` |
| `WORKER_TYPE_CATALOG` | `COMPUTE_TARGET_CATALOG` |
| import path `worker-type-catalog` | `compute-target-catalog` |

> Do **not** rename `ExecutionMode`, `Connectivity`, `IExecutionEnvironment`, or the backend/execution-environment classes — they are not "worker" and stay as-is.

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename WorkerType/ResolvedWorker/catalog -> ComputeTarget* core types"
```

---

## Task 4: Rename package symbols (`resolveWorker` → `resolveComputeTarget`, etc.)

**Files:**
- Move: `packages/compute/src/worker-record.ts` → `packages/compute/src/compute-target-record.ts` (and its `.test.ts`)
- Modify: `packages/compute/src/db.ts`, `resolver.ts`, `index.ts`, `routes/index.ts`, and callers `packages/orchestrator/src/cli-worker.ts`, `packages/api-server/src/composition.ts`.

- [ ] **Step 1: Move the record file**

```bash
git mv packages/compute/src/worker-record.ts packages/compute/src/compute-target-record.ts
git mv packages/compute/src/worker-record.test.ts packages/compute/src/compute-target-record.test.ts
```

- [ ] **Step 2: Find references**

```bash
grep -rn "resolveWorker\|WorkerNotFoundError\|ResolveWorkerCtx\|fetchWorkerById\|fetchDefaultWorker\|insertWorker\|listWorkers\|listVisibleWorkers\|getWorker\|updateWorker\|deleteWorker\|validateWorkerInput\|InvalidWorkerInputError\|rowToWorker\|WorkerInputShape\|worker-record" --include="*.ts" --include="*.tsx" packages | grep -v node_modules
```

- [ ] **Step 3: Apply the symbol renames repo-wide**

| Old | New |
|---|---|
| `resolveWorker` | `resolveComputeTarget` |
| `WorkerNotFoundError` | `ComputeTargetNotFoundError` |
| `ResolveWorkerCtx` | `ResolveComputeTargetCtx` |
| `fetchWorkerById` | `fetchComputeTargetById` |
| `fetchDefaultWorker` | `fetchDefaultComputeTarget` |
| `insertWorker` | `insertComputeTarget` |
| `listWorkers` | `listComputeTargets` |
| `listVisibleWorkers` | `listVisibleComputeTargets` |
| `getWorker` | `getComputeTarget` |
| `updateWorker` | `updateComputeTarget` |
| `deleteWorker` | `deleteComputeTarget` |
| `validateWorkerInput` | `validateComputeTargetInput` |
| `InvalidWorkerInputError` | `InvalidComputeTargetInputError` |
| `rowToWorker` | `rowToComputeTarget` |
| `WorkerInputShape` | `ComputeTargetInputShape` |
| import path `worker-record` | `compute-target-record` |

> In `cli-worker.ts`: rename the imported `resolveWorker`→`resolveComputeTarget` and the `resolveWorker:` **dep key** in the `ensureWs` object → `resolveComputeTarget:`. Keep the constructor field `workerId: process.env.WORKER_ID ?? ...` exactly as-is (engine id). The local selector variable named `workerId` inside that dep callback is renamed in Task 5.

- [ ] **Step 4: Verify**

Run: `npm run check` then `( cd packages/compute && npx vitest run )`
Expected: PASS (the moved `.test.ts` files still pass against the renamed symbols).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename worker store/resolver symbols -> computeTarget*"
```

---

## Task 5: Split the selector — flow `workerId` → `computeTargetId` (+ backward-compat)

**Files:**
- Modify: `packages/core/src/types/flow.types.ts:125-126,237`
- Modify: `packages/orchestrator/src/flow-json/apply-flow-defaults.ts`
- Test: `packages/orchestrator/src/flow-json/apply-flow-defaults.test.ts`
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts:384`
- Modify: `packages/orchestrator/src/workers/worker-harness.ts` (the `computeTargetId`/selector usage in the `ensureWorkspace` block), `packages/orchestrator/src/sandbox/ensure-workspace.ts` (the selector arg)
- Modify: `packages/orchestrator/src/cli-worker.ts` (the `ensureWs` dep arg + `ensureWorkspace` selector field)

- [ ] **Step 1: Rename the canonical field in `flow.types.ts`**

At both sites (node config ~line 126, and defaults ~line 237), rename the field. Keep the legacy key readable but do NOT add it to the type — it is read via the compat shim in Step 3.

```ts
// node config (was: /** Per-step worker override ... */ workerId?: string)
/** Per-step compute-target override (workspace-independent steps only). Falls back to defaults.computeTargetId. */
computeTargetId?: string;
```
```ts
// defaults (was: workerId?: string)
computeTargetId?: string;
```

- [ ] **Step 2: Write the failing backward-compat test**

In `apply-flow-defaults.test.ts` add (match the existing `applyFlowDefaults` call shape used in that file):

```ts
it("treats a legacy node.workerId as computeTargetId (node source)", () => {
  const node = { id: "n1", type: "implement", config: {}, workerId: "ct-legacy" } as any;
  const defaults = {} as any;
  const { resolved, sources } = applyFlowDefaults(node, defaults);
  expect(resolved.computeTargetId).toBe("ct-legacy");
  expect(sources["computeTargetId"]).toBe("node");
});

it("treats a legacy defaults.workerId as computeTargetId (workflow-default source)", () => {
  const node = { id: "n1", type: "implement", config: {} } as any;
  const defaults = { workerId: "ct-default" } as any;
  const { resolved, sources } = applyFlowDefaults(node, defaults);
  expect(resolved.computeTargetId).toBe("ct-default");
  expect(sources["computeTargetId"]).toBe("workflow-default");
});

it("prefers the new computeTargetId over the legacy workerId", () => {
  const node = { id: "n1", type: "implement", config: {}, computeTargetId: "ct-new", workerId: "ct-old" } as any;
  const { resolved } = applyFlowDefaults(node, {} as any);
  expect(resolved.computeTargetId).toBe("ct-new");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/orchestrator && npx vitest run src/flow-json/apply-flow-defaults.test.ts`
Expected: FAIL (`resolved.computeTargetId` is undefined; old code sets `workerId`).

- [ ] **Step 4: Implement the selector + compat in `apply-flow-defaults.ts`**

Replace the existing worker-selection block (the `const workerId = node.workerId ?? defaults.workerId; ...` lines and the `...(workerId ? { workerId } : {})` in the returned `resolved`) with:

```ts
  // Compute-target selection: node-level override wins, else the flow default.
  // Legacy flows used `workerId`; read it as a fallback so saved flows keep working.
  const nodeCt = node.computeTargetId ?? (node as { workerId?: string }).workerId;
  const defCt  = defaults.computeTargetId ?? (defaults as { workerId?: string }).workerId;
  const computeTargetId = nodeCt ?? defCt;
  if (computeTargetId) sources["computeTargetId"] = nodeCt ? "node" : "workflow-default";

  return {
    resolved: { ...node, retry, executorConfig, model, ...(computeTargetId ? { computeTargetId } : {}) },
    sources,
  };
```

Also delete the leftover `workerId` spread on `resolved` if any remains, and update the block comment to say "compute target" / `resolveComputeTarget`.

- [ ] **Step 5: Update the downstream selector references**

| File | Old | New |
|---|---|---|
| `conductor-converter.ts:384` | `...(resolvedNode.workerId ? { workerId: resolvedNode.workerId } : {})` | `...(resolvedNode.computeTargetId ? { computeTargetId: resolvedNode.computeTargetId } : {})` |
| `worker-harness.ts` | the `(stepInput as { workerId?: string }).workerId` reads that feed `ensureWorkspace` | `(stepInput as { computeTargetId?: string }).computeTargetId` |
| `ensure-workspace.ts` | the `workerId` field on the `ensureWorkspace` **args** type + its use in `resolveComputeTarget(... )` | `computeTargetId` |
| `cli-worker.ts` | the `ensureWs` closure param/field `workerId` (selector) passed to `resolveComputeTarget`, and the `workerId` key in the `ensureWorkspace` args object | `computeTargetId` |

> CRITICAL: do not touch `worker-harness.ts`'s constructor field `workerId` (the engine id), `WorkflowLogCtx` `workerId`, `conductor-client.ts` `pollTask(taskType, workerId)`, or `process.env.WORKER_ID`. Only the *selector* usages rename. After this task, `worker-harness.ts` legitimately contains both `computeTargetId` (selector) and `workerId` (engine) — that is the intended disambiguation.

Also rename the `_flowDefaultSources` consumer key if present: search `"workerId"` string keys in `worker-harness.ts`/`conductor-converter.ts` tied to the selector and rename to `"computeTargetId"`.

- [ ] **Step 6: Run tests + check**

Run:
```bash
cd packages/orchestrator && npx vitest run src/flow-json
npm run check
```
Expected: PASS (new compat tests + existing apply-flow-defaults tests; typecheck clean).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: flow selector workerId -> computeTargetId with legacy read compat"
```

---

## Task 6: Rename the DB table `jm_workers` → `jm_compute_targets`

**Files:**
- Create: `packages/migrations/src/sql/037_rename_workers_to_compute_targets.sql`
- Modify: `packages/compute/src/db.ts` (all SQL strings), `packages/compute/src/db.test.ts` (the insert-regex assertion)

- [ ] **Step 1: Write the migration**

Create `packages/migrations/src/sql/037_rename_workers_to_compute_targets.sql`:

```sql
-- 037_rename_workers_to_compute_targets.sql
-- Behavior-preserving rename of jm_workers -> jm_compute_targets (Spec A).
-- Data-preserving: ALTER ... RENAME does not copy or drop rows.
ALTER TABLE IF EXISTS jm_workers RENAME TO jm_compute_targets;
ALTER INDEX IF EXISTS idx_jm_workers_org_user RENAME TO idx_jm_compute_targets_org_user;
ALTER TABLE jm_compute_targets RENAME CONSTRAINT jm_workers_scope_shape TO jm_compute_targets_scope_shape;
```

(The runner tracks applied ids in `jm_schema_migrations`, so this runs exactly once.)

- [ ] **Step 2: Update the SQL strings in `db.ts`**

Replace every `jm_workers` with `jm_compute_targets` in `packages/compute/src/db.ts` (INSERT/SELECT/UPDATE/DELETE — ~9 occurrences). No column names change.

- [ ] **Step 3: Update the `db.test.ts` assertion**

In `packages/compute/src/db.test.ts`, change the regex `/insert into jm_workers/i` → `/insert into jm_compute_targets/i`.

- [ ] **Step 4: Verify migration applies on a populated DB**

Run (with infra up + a row present):
```bash
npm run infra:up
npm run migrate
psql "$DATABASE_URL" -c "SELECT count(*) FROM jm_compute_targets;"
```
Expected: migration `037` applies; the row count matches what `jm_workers` had (data preserved). If `DATABASE_URL` isn't set locally, at minimum run `cd packages/compute && npx vitest run src/db.test.ts` (PASS).

- [ ] **Step 5: Check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(db): rename jm_workers -> jm_compute_targets (migration 037)"
```

---

## Task 7: Rename API routes + web + flow-editor UI

**Files:**
- Modify: `packages/compute/src/routes/index.ts` (route paths)
- Move/Modify (web): `packages/web/src/api/workers.ts` → `api/computeTargets.ts`; `packages/web/src/routes/WorkersPage.tsx` → `routes/ComputeTargetsPage.tsx`; `packages/web/src/components/workers/` → `components/compute-targets/` (incl. `WorkerFormModal.tsx` → `ComputeTargetFormModal.tsx`, `types/registry.ts`, the config forms); `packages/web/src/App.tsx`
- Move/Modify (flow-editor): `packages/flow-editor/src/properties-panel/WorkerTab.tsx` → `ComputeTargetTab.tsx`; `packages/flow-editor/src/flow-config/DefaultsWorkerSection.tsx` → `DefaultsComputeTargetSection.tsx`; references in `tabs-shell.tsx`, `PropertiesPanel.tsx`

- [ ] **Step 1: Rename the route paths**

In `packages/compute/src/routes/index.ts`, replace the path segment `/workers` with `/compute-targets` in every route (8 org-scoped + the `/users/me/...` twins). Example: `"/api/orgs/:orgId/workers/visible"` → `"/api/orgs/:orgId/compute-targets/visible"`. Leave handler logic untouched.

- [ ] **Step 2: Move + rename the web files**

```bash
git mv packages/web/src/api/workers.ts packages/web/src/api/computeTargets.ts
git mv packages/web/src/routes/WorkersPage.tsx packages/web/src/routes/ComputeTargetsPage.tsx
git mv packages/web/src/components/workers packages/web/src/components/compute-targets
git mv packages/web/src/components/compute-targets/WorkerFormModal.tsx packages/web/src/components/compute-targets/ComputeTargetFormModal.tsx
git mv packages/flow-editor/src/properties-panel/WorkerTab.tsx packages/flow-editor/src/properties-panel/ComputeTargetTab.tsx
git mv packages/flow-editor/src/flow-config/DefaultsWorkerSection.tsx packages/flow-editor/src/flow-config/DefaultsComputeTargetSection.tsx
```

- [ ] **Step 3: Apply identifier + path + label renames**

| Old | New |
|---|---|
| `workersApi` | `computeTargetsApi` |
| exported web `Worker` type | `ComputeTarget` |
| `WorkersPage` | `ComputeTargetsPage` |
| `WorkerFormModal` | `ComputeTargetFormModal` |
| `WorkerTab` | `ComputeTargetTab` |
| `DefaultsWorkerSection` | `DefaultsComputeTargetSection` |
| fetch paths `/api/orgs/${orgId}/workers...` | `/api/orgs/${orgId}/compute-targets...` |
| App routes `/me/workers`, `/admin/workers` | `/me/compute-targets`, `/admin/compute-targets` |
| nav/title labels `My Workers` / `Org Workers` | `My Compute Targets` / `Org Compute Targets` |
| `node.workerId` / `defaults.workerId` reads in the tab/defaults section | `node.computeTargetId` / `defaults.computeTargetId` |
| import paths `./components/workers/...`, `WorkerTab`, `DefaultsWorkerSection`, `workers.ts` | the new paths/names |

Find any stragglers:
```bash
grep -rn "workers\|Worker" packages/web/src packages/flow-editor/src | grep -v node_modules
```
Each remaining hit should be re-evaluated against the naming rule (none should refer to the config concept).

- [ ] **Step 4: Verify**

Run:
```bash
npm run check
npm run build:web
```
Expected: typecheck clean; web build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename compute-target API routes + web/flow-editor UI"
```

---

## Task 8: Examples, docs, and final audit

**Files:**
- Modify: `examples/flows/*.json` (any `workerId` keys), `README.md` / `docs/**` references, `.env.example` if it mentions workers-as-config
- Audit: whole repo

- [ ] **Step 1: Update example flows + docs**

```bash
grep -rln "workerId" examples docs | grep -v node_modules
```
In example **flow JSON**, rename `workerId` keys → `computeTargetId`. In prose docs, update "worker" → "compute target" only where it refers to the config concept (leave engine-process mentions). Update the CLAUDE.md / README package table entry `@journeyman/workers` → `@journeyman/compute` if present.

- [ ] **Step 2: Final disambiguation audit**

Run:
```bash
grep -rni "worker" packages --include="*.ts" --include="*.tsx" --include="*.sql" | grep -v node_modules | grep -v ".test." 
```
Expected: every remaining match is one of — `WorkerHarness`, `worker-harness`, `cli-worker`, `WORKER_ID`/`process.env.WORKER_ID`, the engine `workerId` (harness ctor, `WorkflowLogCtx`, `conductor-client.pollTask`), `orchestrator/src/workers/` dir, or a log string like `"worker starting"`. Anything referring to the *config concept* is a miss — fix it.

- [ ] **Step 3: Full verification**

Run:
```bash
npm run check
npm test
```
Expected: typecheck + boundaries clean; test suites pass (pre-existing "no test suite found" packages are not regressions).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: update examples/docs to computeTargetId; finish worker->compute-target rename"
```

---

## Self-Review (completed)

- **Spec coverage:** DB rename (Task 6), core record types (Task 2), core exec-target types (Task 3), package rename (Task 1), package symbols (Task 4), routes + web + flow-editor (Task 7), the `workerId`→`computeTargetId` split + stored-flow backward-compat (Task 5), engine-process kept as "worker" (enforced by the audit in Task 8). All spec sections map to a task.
- **Placeholder scan:** none — rename tasks use exact old→new mapping tables + verify commands; the two new-code tasks (6 migration, 5 compat) include full code + tests.
- **Type consistency:** symbol names are consistent across tasks (`ComputeTarget`, `ComputeTargetType`, `ResolvedComputeTarget`, `resolveComputeTarget`, `computeTargetId`, `jm_compute_targets`, `@journeyman/compute`). The engine `workerId` is explicitly preserved in Tasks 4 & 5.
- **Ordering:** package rename first (Task 1) so later tasks reference `@journeyman/compute`; each task renames a symbol-cluster repo-wide so `npm run check` stays green per task.
