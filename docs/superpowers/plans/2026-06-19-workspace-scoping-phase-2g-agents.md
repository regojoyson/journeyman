# Workspace Scoping — Phase 2g: Agents Cutover — Implementation Plan

> Executed by a cheaper model: follow literally. Hard contracts are specified; make no design decisions. STOP and report if a typecheck error can't be fixed with a minimal edit per this plan.

**Goal:** Make agents **workspace-scoped**. `jm_agents`: drop `scope`/`user_id` → add `workspace_id`. **Keep `org_id`** (set from the workspace's org at create) so trigger/token/settings/runtime paths that read `agent.orgId` are unchanged. Collapse the `/users/me/agents` + `/agents` route split into `/api/workspaces/:wsId/agents`. Wire `agent.workspaceId` into `runAgent` (replacing the `workspaceId: null` interim from 2f).

**Branch:** `feat/workspace-scoping-phase-2b`. **Migration:** `055`. **Clean break:** delete existing agent rows (no workspace).

**Batched workflow:** all edits → one `npm run migrate` → one `npm run typecheck` + `check:boundaries` → one commit. Pattern = phases 2c/2d/2e.

---

## Edits

### 1. Migration `packages/migrations/src/sql/055_agents_workspace_scope.sql`
```sql
-- 055_agents_workspace_scope.sql
-- Agents become workspace-scoped (org_id retained, derived from the workspace).
-- Clean break: existing agent rows carry no workspace.
DELETE FROM jm_agents;  -- cascades to jm_agent_api_tokens / jm_agent_idempotency / jm_agent_schedule_state
ALTER TABLE jm_agents DROP CONSTRAINT IF EXISTS jm_agents_scope_name_unique;
DROP INDEX IF EXISTS idx_jm_agents_org_user;
ALTER TABLE jm_agents DROP COLUMN scope, DROP COLUMN user_id;
ALTER TABLE jm_agents
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE;
ALTER TABLE jm_agents
  ADD CONSTRAINT jm_agents_name_unique UNIQUE (workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_jm_agents_workspace ON jm_agents (workspace_id);
```
Run `npm run migrate` once.

### 2. Core `packages/core/src/types/agent.types.ts`
- Delete `export type AgentScope = "user" | "org";`.
- `Agent`: remove `scope` and `userId`; add `workspaceId: string`. Keep `orgId: string`.
- `AgentCreateInput`: change `Pick<Agent, "scope" | "name">` → `Pick<Agent, "name">` (drop scope). The `Omit` in its `Partial<...>` already omits orgId/userId; also omit `workspaceId` there (server sets it). Concretely:
  ```ts
  export type AgentCreateInput = Pick<Agent, "name"> &
    Partial<Omit<Agent, "id"|"name"|"orgId"|"workspaceId"|"createdBy"|"createdAt"|"updatedAt">>;
  export type AgentUpdateInput = Partial<
    Omit<Agent, "id"|"orgId"|"workspaceId"|"createdBy"|"createdAt"|"updatedAt">
  >;
  ```

### 3. `packages/agents/src/db.ts`
- `rowToAgent`: map `workspaceId: r.workspace_id`; drop `scope`/`userId` mapping.
- `COLUMN_KEYS`: replace `scope, userId` with `workspaceId` (keep `orgId`).
- `buildInsert` / `insertAgent` input: `AgentCreateInput & { workspaceId: string; orgId: string; createdBy: string }` (drop `userId`). INSERT columns `(workspace_id, org_id, name, status, enabled, definition, created_by)`.
- `listAgents(pool, workspaceId)`: `WHERE workspace_id = $1 ORDER BY name ASC` (drop the userId param + COALESCE clause).
- `getAgent`/`updateAgent`/`deleteAgent`/`findAgentByWebhookId`: unchanged (id/webhook-keyed). Ensure `updateAgent`'s dynamic SET never touches workspace_id.

### 4. `packages/agents/src/run-agent.ts`
Line ~43: replace `workspaceId: null, // TODO(agents cutover 2g)...` with `workspaceId: agent.workspaceId,`.

### 5. Routes `packages/api-server/src/routes/agents.ts`
- Add `makeRequireWorkspacePermission`. Collapse the user/org list+create into workspace routes:
  - `GET /api/workspaces/:wsId/agents` (resource.read) → `listAgents(pool, wsId)`
  - `POST /api/workspaces/:wsId/agents` (resource.write) → `insertAgent(pool, { ...body, workspaceId: wsId, orgId: ctx.workspace!.orgId, createdBy: ctx.user.id })` (drop `scope` from body handling)
  - `GET/PATCH/DELETE/enable/disable/runs` → `/api/workspaces/:wsId/agents/:id` (read for GET/runs-list, write for the rest). For each, after `getAgent(pool, id)`, 404 unless `agent.workspaceId === wsId`.
  - The manual run route `POST /api/workspaces/:wsId/agents/:id/runs`: `runAgentGuarded(deps, agent, inputs, "manual", { userId: ctx.user.id, orgId: agent.orgId })` (unchanged startedBy shape; orgId from agent).
- **Org-level routes stay org-scoped** (they are not per-agent): `GET/PUT /api/orgs/:orgId/agent-settings` and `GET /api/orgs/:orgId/audit` — leave them as-is (keep `requireAuth`/role as they are).

### 6. Routes `packages/api-server/src/routes/agent-triggers.ts`
- Move the three api-token routes to `/api/workspaces/:wsId/agents/:id/triggers/api-token[...]` (resource.write), each 404ing unless the loaded agent's `workspaceId === wsId`. Token insert still records `org_id` from `agent.orgId`.
- `POST /api/agents/:id/fire` (Bearer token, no session): UNCHANGED — it loads the agent by id and uses `agent.orgId`; no workspace param.

### 7. Web (keep compiling; UI consolidation is Phase 3)
- `packages/web/src/api/agents.ts`: route list/create/get/etc. to `/api/workspaces/:wsId/agents` (the client takes `wsId` instead of `orgId` for agent CRUD; org-settings/audit stay on orgId). Drop `scope` from create body. Minimal edits to compile — if a `wsId` isn't available at a call site, that's a Phase 3 wiring concern; keep the function signature compiling.
- `packages/web/src/components/agents/AgentsList.tsx`, `MyAgentsPage.tsx`, `AdminAgentsPage.tsx`: drop the `scope` prop and any `agent.scope` reads. Single workspace list.
- Any other web file reading `agent.scope`/`agent.userId`: drop the usage.

### 8. Verify + commit (once)
```
npm run migrate
npm run typecheck            # clean across all workspaces
npm run check:boundaries
npm test -w @journeyman/agents   # update db.test.ts/run-agent.test.ts fixtures: drop scope/userId, add workspaceId
git checkout feat/workspace-scoping-phase-2b
git add -A
git commit -m "feat(agents): workspace-scoped agents (migration 055; drop scope/user, keep org_id)"
```
Update `packages/agents/src/db.test.ts` and `run-agent.test.ts` (and any api-server agent test fixtures) to drop `scope`/`userId` and add `workspaceId` where an `Agent`/`AgentCreateInput`/insert input is constructed.

---

## Notes
- `org_id` is RETAINED on `jm_agents` (set from the workspace's org at create) specifically so `run-agent`, `agent-webhook-fire`, `agent-scheduler`, the `/fire` route, `jm_agent_api_tokens`, and org `agent-settings` keep working unchanged.
- After this phase, `run-agent` passes the real `agent.workspaceId`, so agent runs resolve workspace-tier secrets/skills/mcp at runtime (completing the 2f wiring for the agent path).
- `agent-run-step-handler`, `agent-metrics`, `notify-on-terminal`, `agent-alerts` don't read agent scope — no changes expected (confirm via typecheck).
