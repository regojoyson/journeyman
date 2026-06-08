# Rename "Compute Target" → "Sandbox" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the configuration concept "compute target" to "sandbox" repo-wide (types, code, files, package name, DB, API routes, UI, docs), and rename the existing live-container concept from bare "sandbox" to "sandbox instance" to avoid collision.

**Architecture:** Two layers. Config layer (saved definition) `ComputeTarget` → `Sandbox`. Runtime layer (live per-run container) `Sandbox*` → `SandboxInstance*`. The runtime layer is renamed **first** so the freed names (`getSandbox`, `rowToSandbox`, `registerSandboxRoutes`) can be reused by the config layer without collision. Pure rename — zero behavioral change. No stored-data migration (fresh environment); legacy `computeTargetId`/`workerId` fallback code is deleted.

**Tech Stack:** TypeScript (Node, ESM, `.ts` extensions in imports), npm workspaces monorepo, Fastify, PostgreSQL (`pg`, raw SQL), React (web + flow-editor), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-08-rename-compute-target-to-sandbox-design.md`

---

## Conventions used in this plan

- **Rename mapping tables** list every `old symbol` → `new symbol`. Apply them as exact-identifier replacements in the listed files (whole-word; do not partially match inside other words).
- A pure rename of shared `@journeyman/core` types breaks all dependents until every layer is updated. **Per-task `typecheck` will not pass mid-stream.** Each task ends with a commit; the repo-wide green build is verified in the final task (Task 11). Where a task's own package can compile in isolation it is noted.
- After the directory rename in Task 2, all compute-package paths are `packages/sandbox/...` (not `packages/compute/...`). Tasks 3–4 use the new paths.
- Run all commands from the repo root `/Users/admin/data/workspace/claude-skils/journeyman`.

---

## File Structure (what changes)

**Renamed files:**
- `packages/core/src/types/compute-target.types.ts` → `packages/core/src/types/sandbox.types.ts`
- `packages/compute/` (whole dir) → `packages/sandbox/`
- `packages/sandbox/src/compute-target-record.ts` → `sandbox-record.ts` (+ `.test.ts`)
- `packages/sandbox/src/compute-target-catalog.ts` → `sandbox-catalog.ts` (+ `.test.ts`)
- `packages/sandbox/src/sandbox-store.ts` → `sandbox-instance-store.ts` (+ `.test.ts`)
- `packages/sandbox/src/sandbox-reaper.ts` → `sandbox-instance-reaper.ts` (+ `.test.ts`)
- `packages/sandbox/src/cli-sandbox.ts` → `cli-sandbox-instance.ts`
- `packages/sandbox/src/routes/sandboxes.ts` → `routes/sandbox-instances.ts`
- `packages/sandbox/src/routes/compute-targets-build.test.ts` → `routes/sandboxes-build.test.ts`
- `packages/orchestrator/src/sandbox/sandbox-coding-provider.ts` → `sandbox-instance-coding-provider.ts` (+ `.test.ts`)
- `packages/orchestrator/src/sandbox/sandbox-git-provider.ts` → `sandbox-instance-git-provider.ts` (+ `.test.ts`)
- `packages/web/src/components/compute-targets/` (dir) → `packages/web/src/components/sandboxes/`
- `packages/web/src/components/sandboxes/ComputeTargetFormModal.tsx` → `SandboxFormModal.tsx`
- `packages/web/src/api/computeTargets.ts` → `api/sandboxes.ts`
- `packages/web/src/routes/ComputeTargetsPage.tsx` → `routes/SandboxesPage.tsx`
- `packages/flow-editor/src/properties-panel/ComputeTargetTab.tsx` → `SandboxTab.tsx`
- `packages/flow-editor/src/flow-config/DefaultsComputeTargetSection.tsx` → `DefaultsSandboxSection.tsx`

**New files:**
- `packages/migrations/src/sql/040_rename_compute_targets_to_sandboxes.sql`

**Modified (symbols only, names kept):** `packages/core/src/index.ts`, `core/src/types/execution-environment.types.ts`, `core/src/types/flow.types.ts`, `core/src/validation/validate-for-publish.ts`, `sandbox/src/db.ts`, `sandbox/src/resolver.ts`, `sandbox/src/index.ts`, `sandbox/src/routes/index.ts`, `orchestrator/src/flow-json/apply-flow-defaults.ts`, `orchestrator/src/flow-json/conductor-converter.ts`, `orchestrator/src/sandbox/ensure-workspace.ts`, `orchestrator/src/workers/worker-harness.ts`, `orchestrator/src/cli-worker.ts`, `api-server/src/server.ts`, `api-server/src/composition.ts`, `api-server/src/schemas/update-flow.ts`, `web/src/App.tsx`, `flow-editor` panels, `scripts/check-import-boundaries.mjs`, `README.md`, `CLAUDE.md`.

---

## Task 1: Core types — Compute Target → Sandbox + `computeTargetId` → `sandboxId`

**Files:**
- Rename: `packages/core/src/types/compute-target.types.ts` → `packages/core/src/types/sandbox.types.ts`
- Modify: `packages/core/src/types/execution-environment.types.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/types/flow.types.ts`
- Modify: `packages/core/src/validation/validate-for-publish.ts`
- Test: `packages/core/src/validation/validate-for-publish.test.ts`

- [ ] **Step 1: Rename the types file**

```bash
git mv packages/core/src/types/compute-target.types.ts packages/core/src/types/sandbox.types.ts
```

- [ ] **Step 2: Rewrite `sandbox.types.ts`**

Replace the entire file contents with (renames `ComputeTarget*` → `Sandbox*`, `ComputeTargetType` import → `SandboxType`):

```typescript
import type { SandboxType, ExecutionMode, Connectivity } from "./execution-environment.types.ts";

export type SandboxScope = "user" | "org" | "system";

export type ImageState = "none" | "pending" | "building" | "ready" | "failed";

/** A Sandbox row as stored in jm_sandboxes. */
export interface Sandbox {
  id: string;
  scope: SandboxScope;
  /** Set for org/user scope; null for system. */
  orgId: string | null;
  /** Set for user scope; null for org/system. */
  userId: string | null;
  name: string;
  type: SandboxType;
  executionMode: ExecutionMode;
  connectivity: Connectivity | null;
  config: Record<string, unknown>;
  tags: string[];
  enabled: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Managed-image build lifecycle (docker sandboxes). 'none' = use the default box. */
  imageState: ImageState;
  imageFingerprint: string | null;
  imageRef: string | null;
  imageError: string | null;
  imageBuiltAt: Date | null;
}

export interface CreateSandboxArgs {
  scope: SandboxScope;
  orgId: string | null;
  userId: string | null;
  name: string;
  type: SandboxType;
  executionMode: ExecutionMode;
  connectivity?: Connectivity | null;
  config?: Record<string, unknown>;
  tags?: string[];
  enabled?: boolean;
  createdBy: string | null;
}

export interface UpdateSandboxArgs {
  id: string;
  orgId: string | null;
  userId: string | null;
  name?: string;
  executionMode?: ExecutionMode;
  connectivity?: Connectivity | null;
  config?: Record<string, unknown>;
  tags?: string[];
  enabled?: boolean;
}
```

- [ ] **Step 3: Rename `ComputeTargetType` and `ResolvedComputeTarget` in `execution-environment.types.ts`**

In `packages/core/src/types/execution-environment.types.ts`, apply these whole-word identifier renames:

| Old | New |
|---|---|
| `ComputeTargetType` | `SandboxType` |
| `ResolvedComputeTarget` | `ResolvedSandbox` |

(The union members of the type — `"local" | "docker" | ...` — are unchanged.)

- [ ] **Step 4: Update re-exports in `core/src/index.ts`**

Replace the two export blocks (currently lines ~93–113) with:

```typescript
export type {
  SandboxType,
  ExecutionMode,
  Connectivity,
  ExecutionEnvironmentSpec,
  ProvisionedEnv,
  ExecOp,
  ExecResult,
  OperationRunner,
  IExecutionEnvironment,
  ResolvedSandbox,
  ExecutionEnvironmentBackend,
  IExecutionEnvironmentRegistry,
  FileBundle,
} from "./types/execution-environment.types.ts";
export type {
  SandboxScope,
  Sandbox,
  CreateSandboxArgs,
  UpdateSandboxArgs,
} from "./types/sandbox.types.ts";
```

- [ ] **Step 5: Rename the flow field `computeTargetId` → `sandboxId`**

In `packages/core/src/types/flow.types.ts`, replace the WorkflowNode field (currently ~line 125):

```typescript
  /** Per-step sandbox override (workspace-independent steps only). Falls back to defaults.sandboxId. */
  sandboxId?: string;
```

and the WorkflowDefaults field (currently ~line 236):

```typescript
  /** Sandbox this workflow runs on. Required before publish. */
  sandboxId?: string;
```

- [ ] **Step 6: Update validation (drop legacy fallback)**

In `packages/core/src/validation/validate-for-publish.ts`:

Change the PublishError union member:

```typescript
    | "missing_sandbox"
```

Replace the validation block (currently ~lines 88–97) with (no `workerId`/`computeTargetId` fallback):

```typescript
  const defaults = (flow as { defaults?: { sandboxId?: string } }).defaults;
  const sandboxId = defaults?.sandboxId;
  if (!sandboxId || sandboxId.trim().length === 0) {
    errors.push({
      code: "missing_sandbox",
      message: "Select a sandbox for this workflow before publishing.",
      detail: "Every workflow must explicitly choose where its steps run; there is no default.",
      fixes: ["Open Flow Defaults → Run target and pick a sandbox."],
    });
  }
```

- [ ] **Step 7: Update the validation test**

In `packages/core/src/validation/validate-for-publish.test.ts`, replace every occurrence:

| Old | New |
|---|---|
| `"missing_compute_target"` | `"missing_sandbox"` |
| `computeTargetId:` (in test flow fixtures) | `sandboxId:` |
| `workerId:` (in test flow fixtures, if present) | remove / replace with `sandboxId:` |

- [ ] **Step 8: Verify core compiles and its tests pass**

Run: `npm run typecheck -w @journeyman/core && npm test -w @journeyman/core`
Expected: PASS (core is self-contained; no cross-package deps for these types).

- [ ] **Step 9: Commit**

```bash
git add packages/core
git commit -m "refactor(core): rename ComputeTarget types to Sandbox, computeTargetId to sandboxId"
```

---

## Task 2: Rename package `@journeyman/compute` → `@journeyman/sandbox` (name + directory + imports)

**Files:**
- Rename dir: `packages/compute/` → `packages/sandbox/`
- Modify: `packages/sandbox/package.json`
- Modify: `packages/api-server/src/composition.ts`, `packages/api-server/src/server.ts`, `packages/orchestrator/src/cli-worker.ts` (the only external importers)
- Modify: `scripts/check-import-boundaries.mjs`

- [ ] **Step 1: Move the directory**

```bash
git mv packages/compute packages/sandbox
```

- [ ] **Step 2: Update `package.json` name and bin**

In `packages/sandbox/package.json`, change:

```json
  "name": "@journeyman/sandbox",
```

and the bin block (file renamed in Task 3; set the final path now):

```json
  "bin": { "journeyman-sandbox-instance": "./src/cli-sandbox-instance.ts" },
```

- [ ] **Step 3: Update the import-boundary classification**

In `scripts/check-import-boundaries.mjs`, change the entry (currently line ~47):

```javascript
  "@journeyman/sandbox": "backend",
```

- [ ] **Step 4: Update the three external importers' package specifier**

In each of `packages/api-server/src/composition.ts`, `packages/api-server/src/server.ts`, `packages/orchestrator/src/cli-worker.ts`, replace the import specifier string only:

| Old | New |
|---|---|
| `from "@journeyman/compute"` | `from "@journeyman/sandbox"` |

(The imported symbol names are updated in Tasks 3–4; leave them for now.)

- [ ] **Step 5: Reinstall workspace links**

Run: `npm install`
Expected: completes; `node_modules/@journeyman/sandbox` symlink now exists, `@journeyman/compute` gone.

- [ ] **Step 6: Confirm no stray references to the old package name**

Run: `grep -rn "@journeyman/compute" packages scripts tsconfig*.json --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.json" 2>/dev/null`
Expected: no output (zero matches).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: rename @journeyman/compute package to @journeyman/sandbox"
```

---

## Task 3: Runtime layer — `Sandbox*` → `SandboxInstance*` (do this BEFORE Task 4)

This frees the names `getSandbox`, `rowToSandbox`, `registerSandboxRoutes` for the config layer.

**Files:**
- Rename: `packages/sandbox/src/sandbox-store.ts` → `sandbox-instance-store.ts` (+ `.test.ts`)
- Rename: `packages/sandbox/src/sandbox-reaper.ts` → `sandbox-instance-reaper.ts` (+ `.test.ts`)
- Rename: `packages/sandbox/src/cli-sandbox.ts` → `cli-sandbox-instance.ts`
- Rename: `packages/sandbox/src/routes/sandboxes.ts` → `routes/sandbox-instances.ts`
- Rename: `packages/orchestrator/src/sandbox/sandbox-coding-provider.ts` → `sandbox-instance-coding-provider.ts` (+ `.test.ts`)
- Rename: `packages/orchestrator/src/sandbox/sandbox-git-provider.ts` → `sandbox-instance-git-provider.ts` (+ `.test.ts`)
- Modify: `packages/sandbox/src/index.ts`, `orchestrator/src/sandbox/ensure-workspace.ts` (+ its test), `api-server/src/composition.ts`, `api-server/src/server.ts`

- [ ] **Step 1: Rename runtime files**

```bash
git mv packages/sandbox/src/sandbox-store.ts packages/sandbox/src/sandbox-instance-store.ts
git mv packages/sandbox/src/sandbox-store.test.ts packages/sandbox/src/sandbox-instance-store.test.ts
git mv packages/sandbox/src/sandbox-reaper.ts packages/sandbox/src/sandbox-instance-reaper.ts
git mv packages/sandbox/src/sandbox-reaper.test.ts packages/sandbox/src/sandbox-instance-reaper.test.ts
git mv packages/sandbox/src/cli-sandbox.ts packages/sandbox/src/cli-sandbox-instance.ts
git mv packages/sandbox/src/routes/sandboxes.ts packages/sandbox/src/routes/sandbox-instances.ts
git mv packages/orchestrator/src/sandbox/sandbox-coding-provider.ts packages/orchestrator/src/sandbox/sandbox-instance-coding-provider.ts
git mv packages/orchestrator/src/sandbox/sandbox-coding-provider.test.ts packages/orchestrator/src/sandbox/sandbox-instance-coding-provider.test.ts
git mv packages/orchestrator/src/sandbox/sandbox-git-provider.ts packages/orchestrator/src/sandbox/sandbox-instance-git-provider.ts
git mv packages/orchestrator/src/sandbox/sandbox-git-provider.test.ts packages/orchestrator/src/sandbox/sandbox-instance-git-provider.test.ts
```

- [ ] **Step 2: Apply runtime symbol renames**

In `sandbox-instance-store.ts` (+ its test), `sandbox-instance-reaper.ts` (+ test), `cli-sandbox-instance.ts`, `routes/sandbox-instances.ts`, the orchestrator `sandbox-instance-*-provider.ts` (+ tests), `ensure-workspace.ts` (+ test), `composition.ts`, `server.ts`, and `sandbox/src/index.ts`, apply these whole-word identifier renames:

| Old | New |
|---|---|
| `SandboxRecord` | `SandboxInstanceRecord` |
| `RecordSandboxArgs` | `RecordSandboxInstanceArgs` |
| `recordSandbox` | `recordSandboxInstance` |
| `rowToSandbox` | `rowToSandboxInstance` |
| `listActiveSandboxes` | `listActiveSandboxInstances` |
| `getSandbox` | `getSandboxInstance` |
| `markSandboxDestroyed` | `markSandboxInstanceDestroyed` |
| `markSandboxActive` | `markSandboxInstanceActive` |
| `claimSandbox` | `claimSandboxInstance` |
| `SandboxReaper` | `SandboxInstanceReaper` |
| `SandboxReaperDeps` | `SandboxInstanceReaperDeps` |
| `registerSandboxRoutes` | `registerSandboxInstanceRoutes` |
| `SandboxRoutesDeps` | `SandboxInstanceRoutesDeps` |

Note: the DB table name `jm_sandbox_instances` is already correct — do **not** change SQL table names in `sandbox-instance-store.ts`.

- [ ] **Step 3: Update internal relative imports for the renamed files**

In `packages/sandbox/src/index.ts`, update the runtime import paths:

```typescript
export {
  recordSandboxInstance, getSandboxInstance, markSandboxInstanceDestroyed, listActiveSandboxInstances,
  claimSandboxInstance, markSandboxInstanceActive,
} from "./sandbox-instance-store.ts";
export type { SandboxInstanceRecord, RecordSandboxInstanceArgs } from "./sandbox-instance-store.ts";
export { SandboxInstanceReaper } from "./sandbox-instance-reaper.ts";
export type { SandboxInstanceReaperDeps } from "./sandbox-instance-reaper.ts";
export { registerSandboxInstanceRoutes } from "./routes/sandbox-instances.ts";
export type { SandboxInstanceRoutesDeps } from "./routes/sandbox-instances.ts";
```

Also fix any `from "./sandbox-store.ts"` / `from "./sandbox-reaper.ts"` / `from "./routes/sandboxes.ts"` relative imports inside the renamed runtime files and their tests to the new file names.

- [ ] **Step 4: Update the runtime admin route path**

In `packages/sandbox/src/routes/sandbox-instances.ts`, change the route paths:

| Old | New |
|---|---|
| `"/api/sandboxes"` | `"/api/sandbox-instances"` |
| `"/api/sandboxes/:runId"` | `"/api/sandbox-instances/:runId"` |
| `"/api/sandboxes/prune"` | `"/api/sandbox-instances/prune"` |

- [ ] **Step 5: Update `ensure-workspace.ts` dep method name**

In `packages/orchestrator/src/sandbox/ensure-workspace.ts` (+ `ensure-workspace.test.ts`), rename the dep method `getSandbox` → `getSandboxInstance` in the `EnsureWorkspaceDeps` interface and every call site / mock.

- [ ] **Step 6: Update api-server wiring**

In `packages/api-server/src/composition.ts`, the import (already on `@journeyman/sandbox` after Task 2) becomes:

```typescript
import {
  getSandboxInstance, markSandboxInstanceDestroyed, listActiveSandboxInstances,
  DockerExecutionEnvironment, makeDockerClient,
  SandboxInstanceReaper, type SandboxInstanceRecord, type SandboxInstanceRoutesDeps,
} from "@journeyman/sandbox";
```

and rename the local symbols: `sandboxRoutesDeps` → `sandboxInstanceRoutesDeps`, type `SandboxRoutesDeps` → `SandboxInstanceRoutesDeps`, `SandboxRecord` → `SandboxInstanceRecord`.

In `packages/api-server/src/server.ts`, update the runtime route registration (the config route is handled in Task 4):

```typescript
    if (c.sandboxInstanceRoutesDeps) await registerSandboxInstanceRoutes(app, c.pool, c.sandboxInstanceRoutesDeps);
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(sandbox): rename runtime sandbox concept to sandbox instance"
```

---

## Task 4: Config layer — `ComputeTarget*` → `Sandbox*` inside `@journeyman/sandbox`

**Files:**
- Rename: `packages/sandbox/src/compute-target-record.ts` → `sandbox-record.ts` (+ `.test.ts`)
- Rename: `packages/sandbox/src/compute-target-catalog.ts` → `sandbox-catalog.ts` (+ `.test.ts`)
- Rename: `packages/sandbox/src/routes/compute-targets-build.test.ts` → `routes/sandboxes-build.test.ts`
- Modify: `packages/sandbox/src/db.ts`, `resolver.ts`, `routes/index.ts`, `index.ts`, and backend files referencing config symbols

- [ ] **Step 1: Rename config files**

```bash
git mv packages/sandbox/src/compute-target-record.ts packages/sandbox/src/sandbox-record.ts
git mv packages/sandbox/src/compute-target-record.test.ts packages/sandbox/src/sandbox-record.test.ts
git mv packages/sandbox/src/compute-target-catalog.ts packages/sandbox/src/sandbox-catalog.ts
git mv packages/sandbox/src/compute-target-catalog.test.ts packages/sandbox/src/sandbox-catalog.test.ts
git mv packages/sandbox/src/routes/compute-targets-build.test.ts packages/sandbox/src/routes/sandboxes-build.test.ts
```

- [ ] **Step 2: Apply config symbol renames across the package**

In `db.ts`, `sandbox-record.ts` (+ test), `sandbox-catalog.ts` (+ test), `resolver.ts` (+ `resolver.test.ts`), `routes/index.ts`, `routes/sandboxes-build.test.ts`, `index.ts`, and any backend file under `src/backends/` that imports these, apply these whole-word renames:

| Old | New |
|---|---|
| `insertComputeTarget` | `insertSandbox` |
| `listComputeTargets` | `listSandboxes` |
| `getComputeTarget` | `getSandbox` |
| `updateComputeTarget` | `updateSandbox` |
| `deleteComputeTarget` | `deleteSandbox` |
| `listVisibleComputeTargets` | `listVisibleSandboxes` |
| `fetchComputeTargetById` | `fetchSandboxById` |
| `rowToComputeTarget` | `rowToSandbox` |
| `validateComputeTargetInput` | `validateSandboxInput` |
| `InvalidComputeTargetInputError` | `InvalidSandboxInputError` |
| `ComputeTargetInputShape` | `SandboxInputShape` |
| `ComputeTargetTypeDescriptor` | `SandboxTypeDescriptor` |
| `COMPUTE_TARGET_CATALOG` | `SANDBOX_CATALOG` |
| `resolveComputeTarget` | `resolveSandbox` |
| `ComputeTargetNotFoundError` | `SandboxNotFoundError` |
| `ResolveComputeTargetCtx` | `ResolveSandboxCtx` |
| `registerComputeTargetRoutes` | `registerSandboxRoutes` |
| `ComputeTarget` (type) | `Sandbox` |
| `CreateComputeTargetArgs` | `CreateSandboxArgs` |
| `UpdateComputeTargetArgs` | `UpdateSandboxArgs` |
| `ComputeTargetType` | `SandboxType` |
| `ResolvedComputeTarget` | `ResolvedSandbox` |
| `ComputeTargetScope` | `SandboxScope` |

- [ ] **Step 3: Change the config DB table name**

In `packages/sandbox/src/db.ts`, replace every SQL occurrence of the table name:

| Old | New |
|---|---|
| `jm_compute_targets` | `jm_sandboxes` |

(Column names are unchanged — they are domain-neutral.)

- [ ] **Step 4: Update config file relative imports**

In `index.ts`, update the config exports to the new file names:

```typescript
export { SANDBOX_CATALOG } from "./sandbox-catalog.ts";
export type { SandboxTypeDescriptor } from "./sandbox-catalog.ts";
export {
  insertSandbox, listSandboxes, getSandbox, updateSandbox, deleteSandbox,
  listVisibleSandboxes, fetchSandboxById,
} from "./db.ts";
export { rowToSandbox, validateSandboxInput, InvalidSandboxInputError } from "./sandbox-record.ts";
export { resolveSandbox, SandboxNotFoundError } from "./resolver.ts";
export type { ResolveSandboxCtx } from "./resolver.ts";
export { registerSandboxRoutes } from "./routes/index.ts";
```

Fix any `from "./compute-target-record.ts"` / `from "./compute-target-catalog.ts"` relative imports in the package to the new names.

- [ ] **Step 5: Update config API route paths in `routes/index.ts`**

Replace every route path segment:

| Old | New |
|---|---|
| `/compute-targets` | `/sandboxes` |

This covers `/compute-targets`, `/compute-targets/visible`, `/compute-targets/types`, `/compute-targets/test-connection`, `/compute-targets/:id`, `/compute-targets/:id/rebuild`, and the `/users/me/compute-targets[...]` variants.

- [ ] **Step 6: Verify the sandbox package compiles and tests pass**

Run: `npm run typecheck -w @journeyman/sandbox && npm test -w @journeyman/sandbox`
Expected: PASS (package depends only on core, which was updated in Task 1).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(sandbox): rename ComputeTarget config concept to Sandbox"
```

---

## Task 5: Orchestrator flow-json + worker harness — `computeTargetId` → `sandboxId`, drop legacy

**Files:**
- Modify: `packages/orchestrator/src/flow-json/apply-flow-defaults.ts` (+ `apply-flow-defaults.test.ts`)
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Remove legacy fallback in `apply-flow-defaults.ts`**

Find the resolution logic that reads `node.computeTargetId ?? node.workerId` (and the defaults equivalent). Replace it so it reads only `sandboxId`:

```typescript
  const nodeCt = node.sandboxId;
  const defaultCt = defaults?.sandboxId;
  const sandboxId = nodeCt ?? defaultCt;
```

Rename the emitted resolved field to `sandboxId` and delete all `workerId` / `computeTargetId` references. Update any local variable names from `computeTarget*` to `sandbox*` for clarity.

- [ ] **Step 2: Update `apply-flow-defaults.test.ts`**

Replace all `computeTargetId` and `workerId` keys in test fixtures and assertions with `sandboxId`. Remove any test case that specifically asserted legacy-field fallback behavior (no longer supported).

- [ ] **Step 3: Update `conductor-converter.ts`**

Change the task `inputParameters` spread (currently ~line 384):

```typescript
          ...(resolvedNode.sandboxId ? { sandboxId: resolvedNode.sandboxId } : {}),
```

- [ ] **Step 4: Update the worker harness read**

In `packages/orchestrator/src/workers/worker-harness.ts`, find where the task input `computeTargetId` is read and where `resolveComputeTarget` is called. Rename:

| Old | New |
|---|---|
| `computeTargetId` (task input key + local var) | `sandboxId` |
| `resolveComputeTarget` | `resolveSandbox` |
| `ComputeTargetNotFoundError` | `SandboxNotFoundError` |
| `ResolvedComputeTarget` (type import) | `ResolvedSandbox` |

- [ ] **Step 5: Update `cli-worker.ts`**

Apply the same identifier renames from Step 4 to `packages/orchestrator/src/cli-worker.ts` (it imports from `@journeyman/sandbox` — specifier already fixed in Task 2). Update any imported symbol names (`resolveSandbox`, `SandboxNotFoundError`, etc.).

- [ ] **Step 6: Verify orchestrator compiles and tests pass**

Run: `npm run typecheck -w @journeyman/orchestrator && npm test -w @journeyman/orchestrator`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator
git commit -m "refactor(orchestrator): use sandboxId, drop legacy computeTargetId/workerId fallback"
```

---

## Task 6: API server — flow schema + config route registration

**Files:**
- Modify: `packages/api-server/src/schemas/update-flow.ts`
- Modify: `packages/api-server/src/server.ts`

- [ ] **Step 1: Update the flow update schema**

In `packages/api-server/src/schemas/update-flow.ts`, rename the accepted field and remove the legacy comment/handling:

| Old | New |
|---|---|
| `computeTargetId` (schema property, on node and defaults) | `sandboxId` |
| `workerId` (legacy schema property) | remove entirely |

Delete the comment noting "`workerId` is the legacy field".

- [ ] **Step 2: Update the config route registration**

In `packages/api-server/src/server.ts`, the import becomes (combine with the runtime symbol fixed in Task 3):

```typescript
import { registerSandboxRoutes, registerSandboxInstanceRoutes } from "@journeyman/sandbox";
```

and the registration line:

```typescript
    await registerSandboxRoutes(app, c.pool);
```

- [ ] **Step 3: Verify api-server compiles and tests pass**

Run: `npm run typecheck -w @journeyman/api-server && npm test -w @journeyman/api-server`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api-server
git commit -m "refactor(api-server): accept sandboxId and register sandbox routes"
```

---

## Task 7: Web UI — pages, API client, form, routes, labels

**Files:**
- Rename: `packages/web/src/api/computeTargets.ts` → `api/sandboxes.ts`
- Rename: `packages/web/src/routes/ComputeTargetsPage.tsx` → `routes/SandboxesPage.tsx`
- Rename dir: `packages/web/src/components/compute-targets/` → `components/sandboxes/`
- Rename: `components/sandboxes/ComputeTargetFormModal.tsx` → `SandboxFormModal.tsx`
- Modify: `packages/web/src/App.tsx`, plus `components/sandboxes/types/registry.ts`, `LocalConfigForm.tsx`, `DockerConfigForm.tsx`, `form-controls.tsx`

- [ ] **Step 1: Rename files and dir**

```bash
git mv packages/web/src/api/computeTargets.ts packages/web/src/api/sandboxes.ts
git mv packages/web/src/routes/ComputeTargetsPage.tsx packages/web/src/routes/SandboxesPage.tsx
git mv packages/web/src/components/compute-targets packages/web/src/components/sandboxes
git mv packages/web/src/components/sandboxes/ComputeTargetFormModal.tsx packages/web/src/components/sandboxes/SandboxFormModal.tsx
```

- [ ] **Step 2: Rename symbols in the API client (`api/sandboxes.ts`)**

| Old | New |
|---|---|
| `computeTargetsApi` | `sandboxesApi` |
| `ComputeTarget` (type) | `Sandbox` |
| `ComputeTargetType` | `SandboxType` |
| `ComputeTargetScope` | `SandboxScope` |
| `ComputeTargetUpsertBody` | `SandboxUpsertBody` |
| `ComputeTargetTypeDescriptor` | `SandboxTypeDescriptor` |

Change all fetch URL paths from `/compute-targets` → `/sandboxes` (both `/orgs/:orgId/...` and `/users/me/...` variants).

- [ ] **Step 3: Rename symbols in the page (`SandboxesPage.tsx`)**

| Old | New |
|---|---|
| `ComputeTargetsPage` | `SandboxesPage` |
| `computeTargetsApi` | `sandboxesApi` |
| `ComputeTarget` (type) | `Sandbox` |

Update visible UI strings: "Compute Target" → "Sandbox", "Compute Targets" → "Sandboxes". Update the import of the form modal to `SandboxFormModal`.

- [ ] **Step 4: Rename symbols in the form modal (`SandboxFormModal.tsx`)**

| Old | New |
|---|---|
| `ComputeTargetFormModal` | `SandboxFormModal` |
| `ComputeTargetFormModalProps` | `SandboxFormModalProps` |
| `ComputeTarget` / `ComputeTargetType` / etc. | `Sandbox` / `SandboxType` / etc. |

Update visible labels and the import path for `./types/registry.ts` (unchanged path). Update `types/registry.ts`, `LocalConfigForm.tsx`, `DockerConfigForm.tsx`, `form-controls.tsx` for any `ComputeTarget*` type imports → `Sandbox*`.

- [ ] **Step 5: Update routes in `App.tsx`**

```typescript
import { SandboxesPage } from "./routes/SandboxesPage.tsx";
```

```tsx
        <Route path="/me/sandboxes" element={<SandboxesPage orgId={activeOrgId} scope="user" />} />
```

```tsx
        <Route path="/admin/sandboxes" element={role === "admin" ? <SandboxesPage orgId={activeOrgId} scope="org" /> : <Navigate to="/" replace />} />
```

Also update any nav/menu links elsewhere in web that point to `/me/compute-targets` or `/admin/compute-targets` (grep — Step 6).

- [ ] **Step 6: Find residual web references**

Run: `grep -rn "compute-target\|computeTarget\|ComputeTarget\|Compute Target" packages/web/src`
Expected: no output. Fix any remaining (e.g. sidebar labels, breadcrumb text).

- [ ] **Step 7: Verify web compiles**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web
git commit -m "refactor(web): rename compute target UI to sandbox"
```

---

## Task 8: Flow-editor UI — sandbox tab + defaults section

**Files:**
- Rename: `packages/flow-editor/src/properties-panel/ComputeTargetTab.tsx` → `SandboxTab.tsx`
- Rename: `packages/flow-editor/src/flow-config/DefaultsComputeTargetSection.tsx` → `DefaultsSandboxSection.tsx`
- Modify: `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`, `flow-config/FlowConfigPanel.tsx`

- [ ] **Step 1: Rename files**

```bash
git mv packages/flow-editor/src/properties-panel/ComputeTargetTab.tsx packages/flow-editor/src/properties-panel/SandboxTab.tsx
git mv packages/flow-editor/src/flow-config/DefaultsComputeTargetSection.tsx packages/flow-editor/src/flow-config/DefaultsSandboxSection.tsx
```

- [ ] **Step 2: Rename symbols and the node/defaults field**

In `SandboxTab.tsx`:

| Old | New |
|---|---|
| `ComputeTargetTab` | `SandboxTab` |
| `ComputeTargetTabProps` | `SandboxTabProps` |
| `computeTargetId` (node field read/write) | `sandboxId` |

In `DefaultsSandboxSection.tsx`:

| Old | New |
|---|---|
| `DefaultsComputeTargetSection` | `DefaultsSandboxSection` |
| `computeTargetId` (defaults field read/write) | `sandboxId` |

Update visible labels "Compute Target" → "Sandbox" in both. If they call the web API path or `sandboxesApi`, update accordingly.

- [ ] **Step 3: Update the panel imports**

In `PropertiesPanel.tsx` and `FlowConfigPanel.tsx`, update imports and JSX usage: `ComputeTargetTab` → `SandboxTab`, `DefaultsComputeTargetSection` → `DefaultsSandboxSection`.

- [ ] **Step 4: Find residual flow-editor references**

Run: `grep -rn "compute-target\|computeTarget\|ComputeTarget\|Compute Target" packages/flow-editor/src`
Expected: no output.

- [ ] **Step 5: Verify flow-editor compiles**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/flow-editor
git commit -m "refactor(flow-editor): rename compute target tab/section to sandbox"
```

---

## Task 9: Database migration — rename `jm_compute_targets` → `jm_sandboxes`

**Files:**
- Create: `packages/migrations/src/sql/040_rename_compute_targets_to_sandboxes.sql`

- [ ] **Step 1: Create the migration**

Create `packages/migrations/src/sql/040_rename_compute_targets_to_sandboxes.sql` with:

```sql
-- 040_rename_compute_targets_to_sandboxes.sql
-- Behavior-preserving rename of jm_compute_targets -> jm_sandboxes.
-- Data-preserving: ALTER ... RENAME does not copy or drop rows.
ALTER TABLE IF EXISTS jm_compute_targets RENAME TO jm_sandboxes;
ALTER INDEX IF EXISTS idx_jm_compute_targets_org_user RENAME TO idx_jm_sandboxes_org_user;
ALTER INDEX IF EXISTS idx_jm_compute_targets_build RENAME TO idx_jm_sandboxes_build;
ALTER TABLE jm_sandboxes RENAME CONSTRAINT jm_compute_targets_scope_shape TO jm_sandboxes_scope_shape;
```

- [ ] **Step 2: Apply migrations against a fresh DB**

Run: `npm run infra:reset && npm run migrate`
Expected: all migrations apply with no error; final state has tables `jm_sandboxes` and `jm_sandbox_instances`.

- [ ] **Step 3: Verify the table exists under the new name**

Run: `docker compose -f infra/docker-compose.yml exec -T postgres psql -U postgres -d journeyman -c "\dt jm_sandbox*"`
Expected: lists `jm_sandboxes` and `jm_sandbox_instances`; no `jm_compute_targets`.

(If the psql connection details differ, use the project's documented DB connection from `docs/constitution/DATABASE_ARCHITECTURE.md`.)

- [ ] **Step 4: Commit**

```bash
git add packages/migrations
git commit -m "feat(migrations): rename jm_compute_targets to jm_sandboxes"
```

---

## Task 10: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `README.md`**

Replace "Docker compute targets" / "compute target's address" / any "compute target" with the "sandbox" phrasing.

- [ ] **Step 2: Update `CLAUDE.md`**

- In the package table, change `@journeyman/compute` row to `@journeyman/sandbox` and update its scope description (holds Sandbox config + Sandbox Instance runtime).
- Update implementation-status rows mentioning compute targets to "sandbox".
- Search the file for "compute target" / "computeTarget" and update.

- [ ] **Step 3: Verify no stray references in docs (excluding historical specs/plans)**

Run: `grep -rn "compute target\|computeTarget\|compute-target\|ComputeTarget" README.md CLAUDE.md`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: update README and CLAUDE.md for sandbox rename"
```

---

## Task 11: Repo-wide verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + import boundaries**

Run: `npm run check`
Expected: PASS (typecheck across all workspaces + boundary check).

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS in every workspace that has tests.

- [ ] **Step 3: Residual reference sweep (code)**

Run:
```bash
grep -rin "computetarget\|compute_target\|compute-target\|compute target" \
  packages scripts --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.json" --include="*.sql"
```
Expected: no output. (Historical files under `docs/superpowers/` are excluded and may retain the old term.)

- [ ] **Step 4: Residual runtime-collision sweep**

Confirm bare runtime symbols were renamed (no leftover bare `registerSandboxRoutes`/`getSandbox` meaning the *instance*):
Run: `grep -rn "registerSandboxRoutes\|SandboxRoutesDeps\|SandboxRecord\b" packages --include="*.ts"`
Expected: matches refer ONLY to the config layer (`registerSandboxRoutes` in `routes/index.ts` + `server.ts`); no `SandboxRoutesDeps`/`SandboxRecord` (those became `SandboxInstance*`).

- [ ] **Step 5: Manual end-to-end smoke (optional but recommended)**

Start infra + api + web, then: create a Sandbox in the UI (`/me/sandboxes`), open a flow, pick the Sandbox in Flow Defaults (writes `sandboxId`), run it, and confirm a Sandbox Instance is provisioned (`GET /api/sandbox-instances` lists it).

- [ ] **Step 6: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore: finalize compute target -> sandbox rename"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** Part 1 → Tasks 1,4,7,8; Part 2 → Task 3; Part 3 → Task 2; Part 4 → Task 9; Part 5 → Tasks 1,5,6; Part 6 → Task 10. All spec parts have tasks.
- **Collision ordering:** Task 3 (runtime → instance) precedes Task 4 (config claims `getSandbox`/`rowToSandbox`/`registerSandboxRoutes`). Verified in Task 11 Step 4.
- **Type consistency:** `sandboxId` used identically in core (Task 1), orchestrator (Task 5), api-server schema (Task 6), and both UI packages (Tasks 7–8). Config route base `/sandboxes` vs runtime route base `/api/sandbox-instances` are distinct — no path collision.
- **No back-compat:** legacy `workerId`/`computeTargetId` reads removed in Tasks 1 (validation), 5 (apply-flow-defaults), 6 (update-flow schema).
