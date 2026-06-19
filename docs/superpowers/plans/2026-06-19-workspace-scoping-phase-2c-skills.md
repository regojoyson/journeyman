# Workspace Scoping — Phase 2c: Skills Cutover — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans / subagent-driven-development. Checkbox steps.

**Goal:** Make skill packages **workspace-only**. Drop `scope`/`user_id`/`org_id` → single `workspace_id`. Remove promote (user→org) and the org/user route split. Resolution = by workspace.

**Architecture:** `jm_skill_packages` scope columns (`scope`, `user_id`, `org_id`) → `workspace_id UUID NOT NULL`. `SkillPackage.scope/userId/orgId` → `workspaceId`. Routes consolidate to `/api/workspaces/:wsId/skill-packages`. Resolver keys by `workspaceId`. The worker resolves skills by the run's `workspaceId` (null until the Flows cutover wires it → no skills resolved in that intermediate window, documented).

**Depends on:** Phase 1. Migration `051`. Clean break (all existing skill rows dropped — they carry no workspace).

**Pattern:** Same shape as 2a/2b — see those plans for the mechanical cutover template.

---

## Tasks

### Task 1 — core types (`packages/core/src/types/skills.types.ts`)
- [ ] `SkillPackage`: replace `scope: 'user'|'org'; userId?; orgId` with `workspaceId: string`. Remove `SkillScope` if referenced elsewhere (grep). Typecheck core. Commit `feat(core): SkillPackage.workspaceId`.

### Task 2 — migration `051_skills_workspace_scope.sql`
- [ ] Clean break: `DELETE FROM jm_skill_packages;` (rows carry no workspace). Drop constraints `jm_skill_packages_name_unique`, index `idx_jm_skill_packages_org_user`. Drop columns `scope`, `user_id`, `org_id`. Add `workspace_id UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE`. Add `UNIQUE (workspace_id, name)`, index on `workspace_id`.
- [ ] `npm run migrate`; verify `\d jm_skill_packages`. Commit.

```sql
-- 051_skills_workspace_scope.sql
DELETE FROM jm_skill_packages;
ALTER TABLE jm_skill_packages DROP CONSTRAINT IF EXISTS jm_skill_packages_name_unique;
ALTER TABLE jm_skill_packages DROP CONSTRAINT IF EXISTS jm_skill_packages_scope_unique;
DROP INDEX IF EXISTS idx_jm_skill_packages_org_user;
ALTER TABLE jm_skill_packages DROP COLUMN scope, DROP COLUMN user_id, DROP COLUMN org_id;
ALTER TABLE jm_skill_packages
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE;
ALTER TABLE jm_skill_packages ADD CONSTRAINT jm_skill_packages_name_unique UNIQUE (workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_jm_skill_packages_workspace ON jm_skill_packages (workspace_id);
```

### Task 3 — `packages/skills/src/db.ts`
- [ ] `rowToPackage`: map `workspaceId: r.workspace_id` (drop scope/userId/orgId).
- [ ] `insertSkillPackage(pool, { workspaceId, gitUrl, name, cliType?, shareCloneWith? })`: INSERT `(workspace_id, git_url, name, cli_type)`; share-clone source matched by `workspace_id = $workspaceId AND git_url`.
- [ ] `listSkillPackages(pool, workspaceId)`, `getSkillPackage(pool, id, workspaceId)`, `updateEnabledSkills(pool, id, workspaceId, enabled)`, `deleteSkillPackage(pool, id, workspaceId)`: all `WHERE workspace_id = $`.
- [ ] `listSkillPackagesForResolver(pool, workspaceId, cliType)`: `WHERE workspace_id = $1 AND cli_type = $2 AND install_status='ready'`.
- [ ] `listVisibleSkillPackages(pool, workspaceId)` → rows `{id,name,installStatus,enabledSkillCount}` (drop `scope` field). `fetchSkillPackagesByIds(pool, workspaceId, ids)`: `WHERE workspace_id = $1 AND id = ANY`.
- [ ] `findShareableSkillPackage(pool, workspaceId, gitUrl)`.
- [ ] **Delete** `listPromotableSkillPackages`, `promoteSkillPackage`, `PromotableSkillRow`, `VisibleSkillRow.scope`.
- [ ] Keep `updateSkillPackageStatus`, `updateSkillPackageStatusByPath`, `countRowsByLocalPath` (id/path-keyed; unchanged).
- [ ] Typecheck (errors expected in resolver/routes/consumers). Commit.

### Task 4 — `packages/skills/src/resolver.ts`
- [ ] `resolveSkillPackages(pool, workspaceId, cliType)` and `resolveSkillPackagesByIds(pool, ctx: { workspaceId }, ids, cliType)` → call the new db signatures. Commit.

### Task 5 — routes (`packages/skills/src/routes/`)
- [ ] Replace `org-skills.ts` + `user-skills.ts` with one `workspace-skills.ts` mounting `/api/workspaces/:wsId/skill-packages` (list/install/get/patch-enabled/delete/pull/by-url), guarded by `requireWorkspacePermission` (`resource.read` for GET, `resource.write` for mutations). Handlers read `wsId` from params, pass to db. Drop promote + promotable + visible-by-scope routes (keep a `/visible` that returns workspace packages via `listVisibleSkillPackages(pool, wsId)`).
- [ ] Update `routes/index.ts` registration; keep `catalog.ts` (static, unchanged).
- [ ] Typecheck skills package — clean. Commit.

### Task 6 — consumers
- [ ] `packages/api-server/src/routes/builder-chat.ts`: `listSkillPackages(pool, workspaceId)` — builder inventory is workspace-scoped (the builder session's workspace; until Builder cutover, pass the session's workspace or a TODO + the run's workspace). Match the same approach used for other inventory items in this file.
- [ ] `packages/orchestrator/src/cli-worker.ts:403`: `resolveSkillPackagesByIds(pool, { workspaceId: ctx.workspaceId ?? null }, packageIds, "claude")`. If `ctx.workspaceId` is absent (pre-Flows), resolver returns no packages — documented intermediate.
- [ ] Web skills pages/clients: consolidate `MySkillsPage` + `AdminSkillsPage` per §9b → deferred to Phase 3 (needs `wsId`); here, keep the web compiling. If web references `SkillPackage.scope/userId`, update to `workspaceId` or remove usage to keep `npm run typecheck` green.
- [ ] `npm run typecheck && npm run check:boundaries` green. Commit.

### Task 7 — tests + verify
- [ ] Add/adjust `packages/skills/src/db.test.ts` (fakeDb): insert writes `workspace_id`; list/get/resolver filter `workspace_id = $1`; no `scope`/`user_id` in SQL. Run `npm test -w @journeyman/skills`. Full `npm run typecheck && npm run check:boundaries`. Commit.

---

## Notes
- **Runtime workspace dependency:** like 2a, full runtime skill resolution needs the Flows cutover to provide the instance `workspaceId`. Until then `workspaceId` is null at the worker and no skills resolve (workspace-only, no fallback) — documented intermediate, build stays green.
- **Builder inventory** (`builder-chat.ts`) is fully fixed in the Builder portion of the cleanup phase; here keep it compiling.
- Out of scope: web page consolidation (Phase 3 §9b).
