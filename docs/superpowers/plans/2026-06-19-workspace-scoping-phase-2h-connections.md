# Workspace Scoping — Phase 2h: Connections Cutover — Implementation Plan

> Executed by a cheaper model: follow literally. Hard contracts specified; no design decisions. STOP and report if a typecheck error can't be fixed with a minimal edit per this plan.

**Goal:** Make connections (git + notification credentials) **workspace-scoped**. `jm_connections`: drop `scope`/`user_id` → add `workspace_id`. **Keep `org_id`** (set from the workspace's org at create) to minimize ripple. Collapse `/users/me/connections` + `/connections` into `/api/workspaces/:wsId/connections`.

**Branch:** `feat/workspace-scoping-phase-2b`. **Migration:** `056`. **Clean break:** delete existing connection rows.

**Runtime is SAFE:** the worker clone-auth (`agent-run-step-handler.ts`) and `notify-on-terminal.ts` resolve a connection purely by its UUID (`getConnection`/`getConnectionSealed(pool, id)`) — no scope/org/user is read at runtime, so those paths need NO changes. `agentsUsingConnection` (JSONB by UUID) is also unaffected.

**Batched workflow:** all edits → one `npm run migrate` → one `npm run typecheck` + `check:boundaries` → one commit. Pattern = phase 2g (agents).

---

## Edits

### 1. Migration `packages/migrations/src/sql/056_connections_workspace_scope.sql`
```sql
-- 056_connections_workspace_scope.sql
-- Connections become workspace-scoped (org_id retained, derived from the workspace).
-- Clean break: existing rows carry no workspace.
DELETE FROM jm_connections;
ALTER TABLE jm_connections DROP CONSTRAINT IF EXISTS jm_connections_scope_label_unique;
DROP INDEX IF EXISTS idx_jm_connections_org_user;
ALTER TABLE jm_connections DROP COLUMN scope, DROP COLUMN user_id;
ALTER TABLE jm_connections
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE;
ALTER TABLE jm_connections
  ADD CONSTRAINT jm_connections_label_unique UNIQUE (workspace_id, label);
CREATE INDEX IF NOT EXISTS idx_jm_connections_workspace ON jm_connections (workspace_id);
-- keep idx_jm_connections_category (org_id, category) — still valid.
```
Run `npm run migrate` once.

### 2. Core `packages/core/src/types/connection.types.ts`
- Delete `export type ConnectionScope = "user" | "org";`.
- `Connection`: remove `scope` and `userId`; add `workspaceId: string`. Keep `orgId: string`, `category`, `provider`, `label`, etc.
- `ConnectionCreateInput`: change `Pick<Connection, "scope" | "category" | "provider" | "label">` → `Pick<Connection, "category" | "provider" | "label">` (drop scope). `ConnectionUpdateInput` unchanged.

### 3. `packages/connections/src/db.ts`
- `rowToConnection`: map `workspaceId: r.workspace_id`; drop `scope`/`userId`.
- `InsertConnectionInput`: replace `scope`/`userId` with `workspaceId: string` (keep `orgId`, `category`, `provider`, `label`, `baseUrl`, `config`, `credential` (SealedCredential), `createdBy`).
- `insertConnection`: INSERT columns `(workspace_id, org_id, category, provider, label, base_url, cred_ciphertext, cred_iv, cred_auth_tag, config, created_by)`.
- `listConnections(pool, workspaceId, category?)`: `WHERE workspace_id = $1 [AND category = $2] ORDER BY label`. Drop the `(orgId, userId)` + COALESCE form.
- `getConnection`/`getConnectionSealed`/`updateConnection`/`deleteConnection`/`agentsUsingConnection`: unchanged (id-keyed). Ensure `updateConnection` dynamic SET never touches workspace_id/org_id.

### 4. Routes `packages/api-server/src/routes/connections.ts`
- Add `makeRequireWorkspacePermission`. Collapse the user/org create+list factory into workspace routes under `/api/workspaces/:wsId/connections`:
  - `GET /api/workspaces/:wsId/connections` (resource.read) — optional `?category=` → `listConnections(pool, wsId, category)`
  - `POST /api/workspaces/:wsId/connections` (resource.write) — `seal(body.credential)` then `insertConnection(pool, { workspaceId: wsId, orgId: ctx.workspace!.orgId, category, provider, label, baseUrl, config, credential: sealed, createdBy: ctx.user.id })` (drop `scope`)
  - `GET/PATCH/DELETE /api/workspaces/:wsId/connections/:id` (read/write/delete) — after `getConnection(pool, id)`, 404 unless `conn.workspaceId === wsId`. DELETE keeps the `agentsUsingConnection` 409 guard.
  - `POST /api/workspaces/:wsId/connections/:id/test` (resource.read) and `GET /api/workspaces/:wsId/connections/:id/repos` (resource.read) — same workspace-ownership guard, body unchanged (`getConnectionSealed` → `open`).
- Remove the `wrongOrg` org-guard helper usage (requireWorkspacePermission + the workspace-ownership check replace it).

### 5. Web (keep compiling; UI polish is Phase 3)
- `packages/web/src/api/connections.ts`: collapse `listMine`/`listOrg` into `list(wsId, category?)` → `GET /api/workspaces/${wsId}/connections`; `create(wsId, body)` (drop `scope` from `CreateConnectionInput`); `get/update/remove/test/repos(wsId, id, ...)` → workspace paths.
- `packages/web/src/routes/ConnectionsPage.tsx`: drop the `scope` prop; take `wsId` instead of `orgId`; single list via `connectionsApi.list(wsId)`.
- `packages/web/src/App.tsx`: the `/me/connections` and `/admin/connections` routes pass `ConnectionsPage` a `wsId={""}` placeholder (Phase 3 wires the real id), matching how the agent pages were stubbed in 2g. Drop the `scope` prop.
- `packages/web/src/components/agents/EditAgentModal.tsx`: it already has a `wsId` prop (added in 2g) — change its `connectionsApi.listOrg(orgId, "git"|"notification")` calls to `connectionsApi.list(wsId, "git"|"notification")`.
- Any other web file reading `connection.scope`/`connection.userId`: drop the usage.

### 6. Verify + commit (once)
```
npm run migrate
npm run typecheck            # clean across all workspaces
npm run check:boundaries
git checkout feat/workspace-scoping-phase-2b
git add -A
git commit -m "feat(connections): workspace-scoped connections (migration 056; drop scope/user, keep org_id)"
```
If any connections tests construct a `Connection`/`InsertConnectionInput` with `scope`/`userId`, update them to `workspaceId`. (Per the ground truth there is no `connections/src/*.test.ts`; the agent-run-step-handler + notify-on-terminal tests mock connections by UUID and need no change — confirm via `npm test -w @journeyman/orchestrator` / `@journeyman/api-server` if those have agent tests.)

---

## Notes
- `org_id` RETAINED (set from `ctx.workspace.orgId` at create) — keeps the `(org_id, category)` index and avoids touching anything that reads `connection.orgId`.
- Worker clone-auth + notifications resolve by connection UUID only → NO runtime changes; the `connectionId` stored on `AgentRepoSelection`/`AgentNotifications` stays valid.
- Web `/me/connections` vs `/admin/connections` distinction collapses in Phase 3 (§9b) — here just keep both routes compiling against the new workspace client.
