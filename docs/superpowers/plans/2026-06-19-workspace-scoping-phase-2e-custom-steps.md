# Workspace Scoping — Phase 2e: Custom Steps Cutover — Implementation Plan

> Executed by a cheaper model: follow literally, no design decisions. STOP and report if anything is ambiguous — especially the builder package (step 8).

**Goal:** Make custom AI steps **workspace-only**. Table `jm_custom_ai_steps`: drop `scope`/`user_id`/`org_id` → `workspace_id`. Remove the scope-guard (obsolete — all resources are workspace-scoped now), promote, and the org/user route split.

**Branch:** `feat/workspace-scoping-phase-2b`. **Migration:** `053`. **Clean break:** delete all existing rows.

**Batched workflow:** all edits first; `npm run migrate` once; `npm run typecheck` + `check:boundaries` once at the end; commit once at the end. Pattern = Phase 2c/2d.

---

## Steps

### 1. Migration `packages/migrations/src/sql/053_custom_steps_workspace_scope.sql`
```sql
-- 053_custom_steps_workspace_scope.sql
DELETE FROM jm_custom_ai_steps;
ALTER TABLE jm_custom_ai_steps DROP CONSTRAINT IF EXISTS jm_custom_ai_steps_scope_name_unique;
DROP INDEX IF EXISTS idx_jm_custom_ai_steps_org_user;
ALTER TABLE jm_custom_ai_steps
  DROP COLUMN scope, DROP COLUMN user_id, DROP COLUMN org_id;
ALTER TABLE jm_custom_ai_steps
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE;
ALTER TABLE jm_custom_ai_steps
  ADD CONSTRAINT jm_custom_ai_steps_name_unique UNIQUE (workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_jm_custom_ai_steps_workspace ON jm_custom_ai_steps (workspace_id);
```
Run `npm run migrate` once.

### 2. Core `packages/core/src/types/custom-steps.types.ts`
- Delete `export type CustomStepScope = "user" | "org";`.
- `CustomAiStep`: remove `scope`, `userId`, `orgId`; add `workspaceId: string`.
- `CustomAiStepCreateInput`: remove the `scope` field.
- `CustomAiStepUpdateInput`: change `Partial<Omit<CustomAiStepCreateInput, "scope">>` → `Partial<CustomAiStepCreateInput>`.
- Leave export payload types unless they reference `scope` (if `CustomStepExportPayloadV1` carries `scope`, remove that field).

### 3. db.ts `packages/custom-steps/src/db.ts`
- `rowToStep`: map `workspaceId: r.workspace_id`; drop `scope`/`userId`/`orgId`.
- `insertCustomAiStep(pool, input: CustomAiStepCreateInput & { workspaceId: string; createdBy: string })`: INSERT columns `(workspace_id, name, description, icon, input_fields, output_mode, output_schema, prompt_template, default_tools, default_mcp_ids, default_skill_ids, slots, requires_skills, requires_mcp, created_by)` — drop `scope`/`user_id`/`org_id`.
- `listCustomAiSteps(pool, workspaceId)`: `WHERE workspace_id = $1 ORDER BY name`.
- `getCustomAiStep(pool, id)`: unchanged (id-keyed).
- `updateCustomAiStep(pool, id, patch)`: unchanged (id-keyed).
- `deleteCustomAiStep(pool, id)`: unchanged.
- **Delete** `listVisibleCustomAiSteps` and `promoteCustomAiStepToOrg`.

### 4. Delete the scope-guard (now obsolete)
- Delete files: `packages/custom-steps/src/scope-guard.ts`, `scope-guard.test.ts`, `scope-lookup.ts`.
- Remove their exports from `packages/custom-steps/src/index.ts` (`assertScopeSafeDefaults`, `ScopeViolationError`, `ScopeLookup`, `ScopeOffender`, `ResourceScope`, `StepScope`, `buildScopeLookup`).
- Also drop `listVisibleCustomAiSteps` from index exports.

### 5. Routes
- Create `packages/custom-steps/src/routes/workspace-custom-steps.ts` under `/api/workspaces/:wsId/custom-steps`, guarded by `makeRequireAuth` + `makeRequireWorkspacePermission` (read/write/delete per verb):
  - GET `` → `listCustomAiSteps(pool, wsId)`
  - POST `` → `insertCustomAiStep(pool, { workspaceId: wsId, ...body, createdBy: ctx.user.id })` (409 on `DuplicateCustomStepError`). **No `assertScopeSafeDefaults` call.**
  - POST `/import` → `fromExportV1(body)` → `insertCustomAiStep(pool, { workspaceId: wsId, ...parsed, createdBy: ctx.user.id })`.
  - GET `/:id` → `getCustomAiStep(pool, id)`; 404 if null OR `rec.workspaceId !== wsId`.
  - GET `/:id/export` → same workspace guard, then `toExportV1(rec)`.
  - PATCH `/:id` → workspace guard then `updateCustomAiStep(pool, id, body)` (no scope-guard).
  - DELETE `/:id` → workspace guard then `deleteCustomAiStep(pool, id)`.
  - GET `/visible` → `listCustomAiSteps(pool, wsId)` (same as list; kept for the flow-editor palette).
- Delete `org-custom-steps.ts`, `user-custom-steps.ts`, `visible.ts`. Update `routes/index.ts` `registerCustomStepRoutes` to register only the workspace routes.

### 6. Worker handler + flows (verify no change needed)
- `packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts` uses `getCustomAiStep(pool, id)` (id-keyed) — unchanged.
- `packages/api-server/src/routes/flows.ts` uses `getCustomAiStep(c.pool, id)` (id-keyed) — unchanged.
- Confirm both still compile.

### 7. builder-chat inventory
- `packages/api-server/src/routes/builder-chat.ts`: `listCustomAiSteps(pool, orgId, userId)` no longer compiles. Replace the `customSteps` Promise.all slot with an empty stub, matching the `skills`/`mcps` stubs already in that file:
  ```ts
  // TODO(builder cutover): custom steps are workspace-scoped now.
  const customSteps: { id: string; name: string; description: string }[] = [];
  ```
  Remove `customSteps` from the `Promise.all`, remove the `listCustomAiSteps` import.

### 8. BUILDER PACKAGE + WEB — DO NOT GUESS
After steps 1–7, run `npm run typecheck`. You will likely see errors in:
- `packages/builder/src/apply/apply.ts`, `packages/builder/src/agent/intent-schema.ts`, `packages/builder/src/apply/apply.test.ts` (they set/assert `scope` and `userId` on created custom steps — these need a workspace the builder doesn't have yet).
- `packages/api-server/src/routes/builder-apply.ts`.
- Web: `packages/web/src/api/customSteps.ts`, `MyCustomStepsPage`, `AdminCustomStepsPage`, `CustomStepsList.tsx`, `useCustomStepPaletteEntries.ts` (read `.scope`).

**STOP HERE. Do NOT modify the builder package, builder-apply.ts, or web files. Do NOT commit.** Report back, verbatim, the full list of `npm run typecheck` errors (file:line: message). The strong model will resolve the builder/web fallout and do the final commit.

### 9. (Strong model will do) final verify + commit
`npm run typecheck && npm run check:boundaries` clean; `git add -A`; commit `feat(custom-steps): workspace-only (migration 053; drop scope/promote/scope-guard)`.

---

## Notes
- The scope-guard is removed entirely: with skills + MCP now workspace-scoped (2c, 2d), a workspace step can only reference same-workspace resources, so cross-scope leakage is structurally impossible.
- Builder custom-step *creation* depends on the builder having a workspace → resolved in the Builder cutover (2j). Strong model decides the interim (stub/defer) in step 8.
