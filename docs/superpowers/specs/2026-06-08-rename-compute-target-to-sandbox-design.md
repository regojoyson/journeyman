# Rename "Compute Target" → "Sandbox"

**Date:** 2026-06-08
**Status:** Approved — ready for implementation planning
**Scope:** Repo-wide rename of the configuration concept currently called "compute target" to "sandbox", across types, code, file/dir names, package name, DB schema, API routes, UI, and docs.

## Summary

The codebase has two distinct execution-related concepts:

| Layer | What it is | Old name | New name |
|---|---|---|---|
| **Config** | The saved definition of *where & how* to run (local / docker / ecs / image / connectivity). User-managed CRUD. | Compute Target | **Sandbox** |
| **Runtime** | The live, ephemeral provisioned container for a single run, tied to a `runId`. Created and torn down per run. | "sandbox" / sandbox instance | **Sandbox Instance** |

Because the config layer is being renamed to "Sandbox", the runtime layer — which already uses bare `sandbox` identifiers — is renamed to the explicit **"sandbox instance"** to remove all ambiguity. The runtime DB table is *already* named `jm_sandbox_instances`, so this aligns the code with the existing schema name.

### Decisions (locked)

1. **Config layer** `compute target` → `sandbox`.
2. **Runtime layer** made explicit: bare `sandbox` symbols/routes/files → `sandbox instance`.
3. **Package** `@journeyman/compute` → `@journeyman/sandbox`.
4. **Clean break, no back-compat:** flow field becomes `sandboxId`; the legacy fallback code that reads `computeTargetId` and `workerId` is **deleted**. No stored-data migration — environment will be recreated fresh.
5. **DB:** append-only migration renames `jm_compute_targets` → `jm_sandboxes` (mirrors the prior `037_rename_workers_to_compute_targets.sql`).
6. **Runtime file names** are renamed fully explicitly (e.g. `sandbox-coding-provider.ts` → `sandbox-instance-coding-provider.ts`).

## Out of scope

- `WorkerHarness`, `cli-worker.ts`, `WORKER_ID` env var, `WorkflowLogCtx.workerId`, Conductor task `workerId`, and `appendStepEvent` `workerId` — these refer to the **engine harness process**, not the config concept, and are intentionally left unchanged.
- No behavioral/logic changes. This is a pure rename; runtime behavior must be identical afterward.
- No stored flow-JSON data migration (fresh environment).

## Token mapping

### Part 1 — Config layer: Compute Target → Sandbox

**Types (`@journeyman/core`):**

| Old | New |
|---|---|
| `ComputeTarget` | `Sandbox` |
| `ComputeTargetScope` | `SandboxScope` |
| `CreateComputeTargetArgs` | `CreateSandboxArgs` |
| `UpdateComputeTargetArgs` | `UpdateSandboxArgs` |
| `ComputeTargetType` | `SandboxType` |
| `ResolvedComputeTarget` | `ResolvedSandbox` |
| `computeTargetId` (flow.types: node + defaults) | `sandboxId` |

**Files in `@journeyman/core`:**
- `types/compute-target.types.ts` → `types/sandbox.types.ts`
- `types/execution-environment.types.ts` — keep file name; rename the `ComputeTargetType` / `ResolvedComputeTarget` symbols within.
- `index.ts` — update all re-exports.
- `validation/validate-for-publish.ts` — validation code `missing_compute_target` → `missing_sandbox`; message text updated.

**`@journeyman/compute` (→ `@journeyman/sandbox`) config side:**

| Old | New |
|---|---|
| `insertComputeTarget` | `insertSandbox` |
| `listComputeTargets` | `listSandboxes` |
| `getComputeTarget` | `getSandbox` *(see collision note)* |
| `updateComputeTarget` | `updateSandbox` |
| `deleteComputeTarget` | `deleteSandbox` |
| `listVisibleComputeTargets` | `listVisibleSandboxes` |
| `fetchComputeTargetById` | `fetchSandboxById` |
| `rowToComputeTarget` | `rowToSandbox` *(see collision note)* |
| `validateComputeTargetInput` | `validateSandboxInput` |
| `InvalidComputeTargetInputError` | `InvalidSandboxInputError` |
| `ComputeTargetInputShape` | `SandboxInputShape` |
| `ComputeTargetTypeDescriptor` | `SandboxTypeDescriptor` |
| `COMPUTE_TARGET_CATALOG` | `SANDBOX_CATALOG` |
| `resolveComputeTarget` | `resolveSandbox` |
| `ComputeTargetNotFoundError` | `SandboxNotFoundError` |
| `ResolveComputeTargetCtx` | `ResolveSandboxCtx` |
| `registerComputeTargetRoutes` | `registerSandboxRoutes` *(see collision note)* |

**Collision note:** `getSandbox`, `rowToSandbox`, and `registerSandboxRoutes` are names currently used by the **runtime** layer. Part 2 renames those runtime symbols to the `...SandboxInstance...` form *first/together*, freeing the bare names for the config layer.

**Config files in the package:**
- `compute-target-record.ts` → `sandbox-record.ts` (+ `.test.ts`)
- `compute-target-catalog.ts` → `sandbox-catalog.ts` (+ `.test.ts`)
- `resolver.ts` — keep name; rename symbols inside.
- `db.ts` — config queries target `jm_sandboxes`; rename functions.
- `routes/index.ts` / `routes/compute-targets-build.test.ts` → `routes/sandboxes-build.test.ts`; `registerComputeTargetRoutes` → `registerSandboxRoutes`.

**API routes (config CRUD):**
- `GET/POST/PATCH/DELETE .../compute-targets[...]` → `.../sandboxes[...]`
- org-scoped under `/api/orgs/:orgId/sandboxes`, user-scoped under `/api/users/me/sandboxes`
- `/compute-targets/visible` → `/sandboxes/visible`, `/compute-targets/types` → `/sandboxes/types`, `/compute-targets/test-connection` → `/sandboxes/test-connection`, `/compute-targets/:id/rebuild` → `/sandboxes/:id/rebuild`

**JSON request/response field names** are unchanged except the reference field: `computeTargetId` → `sandboxId`. (Existing fields `name`, `type`, `executionMode`, `connectivity`, `config`, `tags`, `enabled`, `imageState`, … keep their names.)

**UI (`@journeyman/web`):**
- dir `components/compute-targets/` → `components/sandboxes/`
- `ComputeTargetFormModal.tsx` → `SandboxFormModal.tsx` (+ `ComputeTargetFormModalProps` → `SandboxFormModalProps`)
- `api/computeTargets.ts` → `api/sandboxes.ts` (+ `computeTargetsApi` → `sandboxesApi`, client types renamed)
- `routes/ComputeTargetsPage.tsx` → `routes/SandboxesPage.tsx` (+ `ComputeTargetsPage` → `SandboxesPage`)
- `App.tsx` routes `/me/compute-targets` → `/me/sandboxes`, `/admin/compute-targets` → `/admin/sandboxes`
- All visible labels: "Compute Target" / "Compute Targets" → "Sandbox" / "Sandboxes"

**UI (`@journeyman/flow-editor`):**
- `properties-panel/ComputeTargetTab.tsx` → `SandboxTab.tsx` (+ props)
- `flow-config/DefaultsComputeTargetSection.tsx` → `DefaultsSandboxSection.tsx` (+ symbol)
- update references in `PropertiesPanel.tsx`, `FlowConfigPanel.tsx`

### Part 2 — Runtime layer: sandbox → Sandbox Instance

| Old | New |
|---|---|
| `SandboxRecord` | `SandboxInstanceRecord` |
| `RecordSandboxArgs` | `RecordSandboxInstanceArgs` |
| `recordSandbox` | `recordSandboxInstance` |
| `rowToSandbox` (runtime) | `rowToSandboxInstance` |
| `listActiveSandboxes` | `listActiveSandboxInstances` |
| `getSandbox` (runtime) | `getSandboxInstance` |
| `markSandboxDestroyed` | `markSandboxInstanceDestroyed` |
| `registerSandboxRoutes` (runtime) | `registerSandboxInstanceRoutes` |
| `SandboxRoutesDeps` | `SandboxInstanceRoutesDeps` |

**Runtime files:**
- `compute/sandbox-store.ts` → `sandbox-instance-store.ts` (+ `.test.ts`)
- `compute/sandbox-reaper.ts` → `sandbox-instance-reaper.ts` (+ `.test.ts`)
- `compute/cli-sandbox.ts` → `cli-sandbox-instance.ts`
- `compute/routes/sandboxes.ts` → `routes/sandbox-instances.ts`
- orchestrator `sandbox/` dir: `sandbox-coding-provider.ts` → `sandbox-instance-coding-provider.ts`, `sandbox-git-provider.ts` → `sandbox-instance-git-provider.ts` (+ their `.test.ts`); `ensure-workspace.ts`, `provisioning-reaper.ts` keep names; rename internal symbols where they reference the renamed providers.

**Runtime route:** `/api/sandboxes` → `/api/sandbox-instances` (admin list / delete / prune).

**DB:** runtime table `jm_sandbox_instances` is already correctly named — no change.

### Part 3 — Package rename

`@journeyman/compute` → `@journeyman/sandbox`:
- `packages/compute/package.json` `name` field.
- Optionally rename the directory `packages/compute/` → `packages/sandbox/` (workspace glob is `packages/*`, so this is safe). **Default: rename the directory** to match the package name.
- Update every `import ... from "@journeyman/compute"` and `@journeyman/compute/...` subpath across the monorepo.
- Update `tsconfig` path mappings, the import-boundary script (`scripts/check-import-boundaries.mjs`), and any references in `CLAUDE.md`.

### Part 4 — Database migration

New append-only migration `packages/migrations/src/sql/040_rename_compute_targets_to_sandboxes.sql`:
- `ALTER TABLE jm_compute_targets RENAME TO jm_sandboxes;`
- rename index `idx_jm_compute_targets_org_user` → `idx_jm_sandboxes_org_user`
- rename index `idx_jm_compute_targets_build` → `idx_jm_sandboxes_build`
- rename constraint `jm_compute_targets_scope_shape` → `jm_sandboxes_scope_shape`

(No column renames needed — the table's columns are domain-neutral: `id`, `scope`, `org_id`, `user_id`, `name`, `type`, `execution_mode`, `connectivity`, `config`, `tags`, `enabled`, image_* columns.)

### Part 5 — Clean break (no back-compat)

- `orchestrator/src/flow-json/apply-flow-defaults.ts`: replace the fallback chain `node.computeTargetId ?? node.workerId` with a direct read of `node.sandboxId` (and the workflow-level default `defaults.sandboxId`). Delete legacy `workerId`/`computeTargetId` handling.
- `api-server/src/schemas/update-flow.ts`: drop the legacy-field comment/handling; accept `sandboxId`.
- `conductor-converter.ts`: propagate `sandboxId`.

### Part 6 — Docs

- `README.md`: "compute target" → "sandbox".
- `CLAUDE.md`: update package table (`@journeyman/compute` → `@journeyman/sandbox`), implementation-status rows, and any compute-target references.
- Prior specs/plans under `docs/superpowers/` are historical records — **leave them as-is** (they describe the earlier worker→compute-target rename and are not living docs).

## Execution strategy

1. Start at the type source (`@journeyman/core`): rename types + files, update `index.ts`.
2. Rename the package (`@journeyman/compute` → `@journeyman/sandbox`), directory, and all imports.
3. Rename runtime-layer symbols/files (Part 2) **before/with** config-layer symbols (Part 1) so the freed names (`getSandbox`, `rowToSandbox`, `registerSandboxRoutes`) don't collide.
4. Update orchestrator, api-server, UI packages.
5. Add the DB migration.
6. Remove back-compat code.
7. Update docs.
8. Run `npm run check` (typecheck + import boundaries) and `npm test` repeatedly; the compiler enumerates every remaining reference. Verify zero residual matches for `compute.target`/`computeTarget`/`compute_target` (case-insensitive) outside historical docs.

## Success criteria

- `npm run check` and `npm test` pass.
- No remaining `compute target` / `computeTarget` / `compute_target` / `ComputeTarget` references in code, types, routes, UI labels, or `CLAUDE.md`/`README.md` (historical specs excluded).
- Config layer consistently uses **Sandbox**; runtime layer consistently uses **Sandbox Instance**, with no bare-name collisions.
- Fresh DB created from migrations yields a `jm_sandboxes` table and a `jm_sandbox_instances` table.
- App runs end-to-end: create a Sandbox in the UI, select it on a flow (`sandboxId`), execute a run that provisions a Sandbox Instance.
