# Spec A — Rename "worker" (config) → "Compute Target"

**Date:** 2026-06-02
**Status:** Proposed
**Scope:** Mechanical, behavior-preserving rename. No functional change.
**Follows-on:** Spec B (Workflow images + image cache) builds on the renamed concept — **not** included here.

## Why

The word **worker** is overloaded. It means both:

1. **The engine process** — the long-running program that polls Conductor and executes steps
   (`cli-worker.ts`, `WorkerHarness`, `WORKER_ID`). This is legitimately a "worker."
2. **The saved execution-environment config** — *where/how* a step's workspace runs (local / docker /
   …), stored in `jm_workers`. This is the thing users create and pick in a flow.

Conflating them is confusing, and it gets worse with Spec B. This spec renames **only meaning #2**
to **Compute Target**, leaving the engine process as "worker."

The clearest evidence of the problem: the identifier `workerId` is used for **both** meanings today —
the compute-target *selector* on a flow node, and the engine-process *id* in the harness, Conductor
poll, and log context. The rename splits them.

## The naming rule (the whole spec in one table)

| Concept | Today | After |
|---|---|---|
| Saved execution-environment config | "worker", `WorkerRecord`, `jm_workers` | **Compute Target**, `ComputeTarget`, `jm_compute_targets` |
| The selector a flow/node uses to pick one | `workerId` (flow.types, node, defaults) | **`computeTargetId`** |
| The engine process | "worker", `WorkerHarness`, `cli-worker.ts` | **unchanged** ("worker") |
| The engine process's own id | `workerId` (harness ctor, Conductor poll, log ctx) | **unchanged** (`workerId`) |

> Rule of thumb: if it describes *a machine config a user creates/selects* → Compute Target. If it
> describes *the running program that does the work* → stays "worker."

## Rename inventory

### Database (`packages/migrations`)
- `jm_workers` → `jm_compute_targets` (table). Rename its index `idx_jm_workers_org_user` →
  `idx_jm_compute_targets_org_user` and constraint `jm_workers_scope_shape` →
  `jm_compute_targets_scope_shape`.
- New **append-only** migration `037_rename_workers_to_compute_targets.sql` using `ALTER TABLE …
  RENAME` (data-preserving — no copy, no data loss). Columns (`scope`, `type`, `config`, …) are
  unchanged. Migration `033_workers.sql` stays as historical record.

### Core types (`packages/core/src/types`)
- `worker.types.ts` → `compute-target.types.ts`:
  `WorkerRecord`→`ComputeTarget`, `WorkerScope`→`ComputeTargetScope`,
  `CreateWorkerArgs`→`CreateComputeTargetArgs`, `UpdateWorkerArgs`→`UpdateComputeTargetArgs`.
- `execution-environment.types.ts`: `WorkerType`→`ComputeTargetType`,
  `ResolvedWorker`→`ResolvedComputeTarget`, `WorkerTypeDescriptor`→`ComputeTargetTypeDescriptor`.
  (`ExecutionMode`, `Connectivity`, and the `IExecutionEnvironment`/backend types are **not**
  "worker" — they stay.)
- `flow.types.ts`: node `workerId?` and `defaults.workerId?` → **`computeTargetId?`**.
- Re-export updates in `core/src/index.ts`.
- **Keep:** `WorkflowLogCtx.workerId` (log/append-step-event) — that's the engine-process id.

### Package `@journeyman/workers` → `@journeyman/compute`
- `package.json` name; importers updated: `api-server` (`package.json`, `composition.ts`,
  `server.ts`), `orchestrator` (`package.json`, `cli-worker.ts`).
- Files: `worker-record.ts`→`compute-target-record.ts` (`validateWorkerInput`→
  `validateComputeTargetInput`, `rowToWorker`→`rowToComputeTarget`, `InvalidWorkerInputError`→
  `InvalidComputeTargetInputError`); `worker-type-catalog.ts`→`compute-target-catalog.ts`
  (`WORKER_TYPE_CATALOG`→`COMPUTE_TARGET_CATALOG`); `resolver.ts` (`resolveWorker`→
  `resolveComputeTarget`, `WorkerNotFoundError`→`ComputeTargetNotFoundError`, `ResolveWorkerCtx`→
  `ResolveComputeTargetCtx`); `db.ts` (`insertWorker`/`listWorkers`/`getWorker`/`updateWorker`/
  `deleteWorker`/`listVisibleWorkers`/`fetchWorkerById`/`fetchDefaultWorker` → `*ComputeTarget`).
- **Keep:** the execution backends and sandbox store (`DockerExecutionEnvironment`,
  `LocalExecutionEnvironment`, `sandbox-store`, `docker-client`, etc.) — they are execution
  environments, not "workers." Only the record/registry/resolver/routes rename.

### API routes (`packages/workers/src/routes/index.ts`)
- `/api/orgs/:orgId/workers*` → `/api/orgs/:orgId/compute-targets*` (incl. `/visible`, `/types`,
  `/test-connection`, `:id`, and the `/users/me/...` twins).
- These are consumed only by our own web app, so route + web client change together. (Optional: a
  short-lived alias route returning 308 for any external callers — likely none.)

### Web (`packages/web`)
- `api/workers.ts`→`api/computeTargets.ts` (`workersApi`→`computeTargetsApi`, `Worker` type→
  `ComputeTarget`); `routes/WorkersPage.tsx`→`ComputeTargetsPage.tsx`; `components/workers/`→
  `components/compute-targets/` (`WorkerFormModal`→`ComputeTargetFormModal`, the config forms,
  `types/registry.ts`).
- `App.tsx` routes `/me/workers`→`/me/compute-targets`, `/admin/workers`→`/admin/compute-targets`;
  nav labels "My/Org Workers" → "My/Org Compute Targets".

### Flow-editor (`packages/flow-editor`)
- `properties-panel/WorkerTab.tsx`→`ComputeTargetTab.tsx`;
  `flow-config/DefaultsWorkerSection.tsx`→`DefaultsComputeTargetSection.tsx`; references in
  `tabs-shell.tsx`, `PropertiesPanel.tsx`. The picker now reads/writes `node.computeTargetId` /
  `defaults.computeTargetId`.

### Orchestrator (`packages/orchestrator`)
- `apply-flow-defaults.ts` and `conductor-converter.ts`: the threaded `workerId` selector → 
  `computeTargetId`; the `_flowDefaultSources` key `"workerId"` → `"computeTargetId"`.
- `worker-harness.ts` / `ensure-workspace.ts`: the `workerId` argument that means "which compute
  target" → `computeTargetId`; **keep** the harness ctor `workerId` (engine id) and Conductor
  `pollTask(taskType, workerId)` (Conductor's own term for the polling client).
- `cli-worker.ts`: keep the filename and `WorkerHarness` usage; rename the `resolveWorker` import →
  `resolveComputeTarget` and the selector variables. Keep `WORKER_ID`/`process.env.WORKER_ID`.

## The tricky bit — stored data backward-compat

Flow definitions are persisted as JSON (nodes + `defaults`) and contain `workerId`. We do **not**
rewrite stored JSON (append-only philosophy; risky). Instead, add a **load-time alias**: when reading
a flow, treat `workerId` as `computeTargetId` if the new key is absent (mirrors the existing
load-time `config.mcp`/`config.allowedTools` compatibility shim). New writes use `computeTargetId`.
`examples/flows/*.json` and any docs are updated to the new key. This keeps existing saved flows
working with zero data migration.

## Migration strategy

1. `ALTER TABLE jm_workers RENAME TO jm_compute_targets;` + rename its index and constraint (one
   append-only migration, `037_…`). Data preserved in place.
2. Code/types/routes/UI renamed in the same change set.
3. Flow JSON: load-time `workerId`→`computeTargetId` alias; no stored-data migration.

## Non-goals

- **No behavior change.** Same execution, same provisioning, same defaults.
- **No image-model change** (that's Spec B). The `config.image` shape on a compute target is left
  exactly as-is for now; Spec B moves it.
- **Engine process keeps the "worker" name** (harness, `cli-worker.ts`, `WORKER_ID`, Conductor poll
  id, log ctx).
- Execution-environment/backend class names are untouched.

## Risks & mitigations

- **Large surface, easy to miss a spot** → after the rename, `npm run check` (typecheck +
  boundaries) must pass; a final `grep -ri "worker"` audit confirms every remaining hit is the
  engine process, not the config concept.
- **Stored flows referencing `workerId`** → covered by the load-time alias; verified by a test that
  loads a flow with the old key and resolves a compute target.
- **Package rename breaking imports** → update all `@journeyman/workers` importers + `package.json`
  + lockfile in one pass; `npm install` to relink the workspace.
- **Route rename breaking the SPA** → web client + routes change together; smoke-test the
  Compute Targets page (list/create/edit/delete/test-connection).

## Verification

1. `npm run check` (typecheck + import boundaries) green.
2. `npm test` for `@journeyman/compute`, `core`, `orchestrator` green.
3. Migration applies on a populated DB and existing rows survive (`SELECT count(*)` before/after).
4. Load a saved flow whose JSON uses the old `workerId` key → it resolves a compute target (alias
   works); saving it writes `computeTargetId`.
5. Web: Compute Targets page lists/creates/edits/deletes/test-connects; flow editor's Compute Target
   tab + defaults section read/write `computeTargetId`.
6. `grep -ri "worker"` audit: every remaining match is the engine process or Conductor's poll id —
   no config-concept "worker" left.
