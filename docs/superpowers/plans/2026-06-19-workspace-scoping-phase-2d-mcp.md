# Workspace Scoping — Phase 2d: MCP Instances Cutover — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox steps. **This plan is executed by a cheaper model: follow it literally, make NO design decisions, and if something doesn't match, stop and report rather than improvise.**

**Goal:** Make MCP instances **workspace-only**. Drop `org_id`/`user_id` → single `workspace_id`. Remove promote/promotable/user routes. Resolver keyed by `workspaceId`.

**Branch:** `feat/workspace-scoping-phase-2b` (continue on it). Re-assert with `git checkout feat/workspace-scoping-phase-2b` before committing.

**Migration number:** `052`.

**Batched workflow (token-saving):** Make ALL edits first. Run `npm run migrate` once (after writing the migration). Run `npm run typecheck` and `npm run check:boundaries` ONCE at the very end. Commit ONCE at the end. Do NOT typecheck or commit per-step.

**Clean break:** Existing `jm_mcp_instances` rows carry no workspace → the migration deletes them all.

**Pattern reference:** identical shape to Phase 2c (skills). See `docs/superpowers/plans/2026-06-19-workspace-scoping-phase-2c-skills.md` if a detail is ambiguous.

---

## Edits (make all of these, then verify + commit once at end)

### 1. Migration — create `packages/migrations/src/sql/052_mcp_workspace_scope.sql`

```sql
-- 052_mcp_workspace_scope.sql
-- MCP instances become workspace-only. Clean break: existing rows carry no
-- workspace, so they are dropped.

DELETE FROM jm_mcp_instances;

ALTER TABLE jm_mcp_instances DROP CONSTRAINT IF EXISTS jm_mcp_instances_scope_unique;
DROP INDEX IF EXISTS idx_jm_mcp_instances_org_user;

ALTER TABLE jm_mcp_instances
  DROP COLUMN org_id,
  DROP COLUMN user_id;

ALTER TABLE jm_mcp_instances
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE;

ALTER TABLE jm_mcp_instances
  ADD CONSTRAINT jm_mcp_instances_scope_unique UNIQUE (workspace_id, name);

CREATE INDEX IF NOT EXISTS idx_jm_mcp_instances_workspace ON jm_mcp_instances (workspace_id);
```

Then run once: `npm run migrate` (dev Postgres on :5433 must be up). Expect `applying 052_mcp_workspace_scope`.

### 2. Core types — `packages/core/src/types/mcp.types.ts`

In `McpInstanceRecord`, replace:
```ts
  orgId: string;
  userId: string | null;
```
with:
```ts
  workspaceId: string;
```
Leave everything else (transport, bindings, etc.) unchanged. `ResolvedMcpInstance` and `McpBinding` are unchanged.

### 3. `packages/mcp/src/db.ts`

Rewrite so every function is keyed by `workspaceId` instead of `(orgId, userId)`. Concretely:

- `rowToRecord` (or equivalent mapper): map `workspaceId: r.workspace_id`; remove `orgId`/`userId` mapping.
- `UpsertInput`: replace `orgId`/`userId` with `workspaceId: string`.
- `insertMcpInstance(pool, input)`: INSERT column list `(workspace_id, name, description, transport, command, args, url, bindings, system_prompt, enabled, created_by)` — `workspace_id` first param = `input.workspaceId`; keep `created_by` = `input.createdBy`. (Drop `org_id`/`user_id` columns.)
- `listMcpInstances(pool, workspaceId)`: `SELECT * FROM jm_mcp_instances WHERE workspace_id = $1 ORDER BY name`.
- `getMcpInstance(pool, id, workspaceId)`: `WHERE id = $1 AND workspace_id = $2`.
- `updateMcpInstance(pool, input)`: `UpdateInput` replaces `orgId`/`userId` with `workspaceId`; WHERE clause `id = $n AND workspace_id = $n+1`.
- `deleteMcpInstance(pool, id, workspaceId)`: `WHERE id = $1 AND workspace_id = $2`.
- `fetchInstancesByIds(pool, workspaceId, ids)`: `SELECT * FROM jm_mcp_instances WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND enabled = true`.
- `listVisibleMcpInstances(pool, workspaceId)`: `SELECT id, name, description, enabled FROM jm_mcp_instances WHERE workspace_id = $1 AND enabled = true ORDER BY name`. Its returned row type drops the `scope` field (now `{ id, name, description, enabled }`).
- **DELETE these functions entirely**: `getUserMcpInstanceById`, `promoteToOrg`, `listPromotable`, and their input/row types (`PromoteInput`, `PromotableRow`, the `VisibleRow.scope` field).
- Keep `DuplicateMcpInstanceError`, `InvalidMcpInputError`.

### 4. `packages/mcp/src/resolver.ts`

```ts
export interface ResolveCtx {
  /** Workspace for instance + secret resolution. Null/undefined => nothing resolves. */
  workspaceId?: string | null;
}

export async function resolveMcpInstances(
  pool: Pool,
  ctx: ResolveCtx,
  instanceIds: string[],
): Promise<ResolvedMcpInstance[]> {
  if (instanceIds.length === 0 || !ctx.workspaceId) return [];
  const found = await fetchInstancesByIds(pool, ctx.workspaceId, instanceIds);
  // ...keep the existing missing-instances check + secret resolution, but pass
  //    ctx.workspaceId as the workspaceId to fetchForResolve (secrets), and use
  //    workspace>org logic identical to the current code's secret block.
}
```
Keep the secret-resolution body; just change `fetchForResolve(pool, <orgId>, <workspaceId>, names)` — secrets still need the org for the org-tier fallback. **Important:** secrets resolution needs BOTH org and workspace. Since `ResolveCtx` no longer carries `orgId`, derive the org from the fetched instances is wrong (instances have no org now). Instead: secrets fetch should pass `orgId = null`? No. **Resolution rule for this plan:** look up the workspace's org via a single query `SELECT org_id FROM jm_workspaces WHERE id = $1` to get `orgId`, then call `fetchForResolve(pool, orgId, ctx.workspaceId, names)` so workspace+org secrets both resolve. Add a small helper or inline that query.

### 5. Routes — `packages/mcp/src/routes/`

- Create `workspace-mcp.ts` exposing under `/api/workspaces/:wsId/mcp-instances`, guarded by `makeRequireAuth` + `makeRequireWorkspacePermission` (`resource.read` for GET, `resource.write` for POST/PATCH, `resource.delete` for DELETE):
  - `GET /api/workspaces/:wsId/mcp-instances` → `listMcpInstances(pool, wsId)`
  - `POST /api/workspaces/:wsId/mcp-instances` → `insertMcpInstance(pool, { workspaceId: wsId, ...body, createdBy: ctx.user.id })` (validate input as the current org route does; 409 on `DuplicateMcpInstanceError`, 400 on `InvalidMcpInputError`)
  - `GET /api/workspaces/:wsId/mcp-instances/visible` → `listVisibleMcpInstances(pool, wsId)`
  - `GET /api/workspaces/:wsId/mcp-instances/:id` → `getMcpInstance(pool, id, wsId)` (404 if null)
  - `PATCH /api/workspaces/:wsId/mcp-instances/:id` → `updateMcpInstance(pool, { id, workspaceId: wsId, ...body })`
  - `DELETE /api/workspaces/:wsId/mcp-instances/:id` → `deleteMcpInstance(pool, id, wsId)`
  - `POST /api/workspaces/:wsId/mcp-instances/:id/test` → call the existing `testMcpInstance` from `test-mcp.ts`'s logic, but pass `{ workspaceId: wsId }` (see note) — if `testMcpInstance` requires orgId/userId, adapt its signature to take `{ workspaceId }` and use `getMcpInstance(pool, id, wsId)` internally.
- **Delete files**: `org-mcp.ts`, `user-mcp.ts`, `promote.ts`, `promotable.ts`, `visible.ts` (its route moves into workspace-mcp.ts). Fold `test-mcp.ts` into workspace-mcp.ts (single workspace test route) or keep `test-mcp.ts` but update it to a single `/api/workspaces/:wsId/mcp-instances/:id/test` route keyed by workspace.
- Keep `catalog.ts` (`GET /api/mcp-catalog`) unchanged.
- Update `routes/index.ts` `registerMcpRoutes` to register only: workspace-mcp routes + catalog (+ test if separate).

### 6. `packages/mcp/src/index.ts`

Remove exports: `getUserMcpInstanceById`, `promoteToOrg`, `listPromotable`. Keep the rest (insert/list/get/update/delete/listVisible/fetchInstancesByIds/resolveMcpInstances/ResolveCtx/registerMcpRoutes/errors).

### 7. Consumers

- `packages/orchestrator/src/cli-worker.ts` (mcpResolver, ~line 397): change to
  ```ts
  mcpResolver: ({ ctx, instanceIds }) => {
    if (!pool) return Promise.resolve([]);
    return resolveMcpInstances(pool, { workspaceId: (ctx as { workspaceId?: string | null }).workspaceId ?? null }, instanceIds);
  },
  ```
  (Same adaptation already used for `skillsResolver`.)
- `packages/api-server/src/routes/builder-chat.ts`: `listMcpInstances(pool, orgId, userId)` no longer compiles. Replace with an empty stub like the skills one already in that file:
  ```ts
  // TODO(builder cutover): mcp instances are workspace-scoped now.
  const mcps: { id: string; name: string }[] = [];
  ```
  Remove `mcps` from the `Promise.all` tuple and the `listMcpInstances` import (the same way `skills`/`listSkillPackages` was handled there in 2c).

### 8. Web (keep compiling; defer UI consolidation to Phase 3)

Run `npm run typecheck` at the end. For ANY web type errors caused by this change (e.g. `web/src/api/mcp.ts`, `MyMcpsPage`, `AdminMcpsPage`, mcp modal components referencing a removed `scope`/`userId`/`orgId` field):
- If the web file defines its OWN local mcp type (not importing core's `McpInstanceRecord`), leave it — no error expected.
- If a web file imports core `McpInstanceRecord` and reads `.userId`/`.orgId`/`.scope`, make the MINIMAL edit to stop referencing the removed field (drop the usage / replace with `workspaceId`). Do NOT rewrite pages or wire a workspace switcher — that is Phase 3 §9b.
- Web client calling deleted routes (`/users/me/mcp-instances`, promote) is a RUNTIME concern, not a typecheck error — leave it for Phase 3 unless it breaks the build.

### 9. Verify + commit ONCE at the end

```bash
npm run migrate                      # applies 052 (idempotent if already run)
npm run typecheck                    # must be clean across all workspaces
npm run check:boundaries             # must be clean
git checkout feat/workspace-scoping-phase-2b
git add -A
git commit -m "feat(mcp): workspace-only MCP instances (migration 052; drop user/org scope, promote)"
```
If typecheck shows errors you cannot resolve with a MINIMAL edit per the rules above, STOP and report the exact errors instead of guessing.

---

## Notes
- Runtime instance/secret resolution needs the Flows cutover (2f) to put `workspaceId` in the worker ctx; until then `mcpResolver` gets a null workspace and resolves nothing — documented intermediate.
- The `sdk-adapter.ts` and `catalog.ts` need NO changes (scope-agnostic).
- No MCP unit tests exist; do not add a new test harness for this phase (typecheck + migrate-verify is the gate). A `db.test.ts` is optional and may be skipped to save tokens.
