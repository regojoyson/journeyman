# Workspace Scoping — Phase 2f: Flows + Workflow Instances Cutover — Implementation Plan

> The largest Phase-2 cutover. It is **all-or-nothing**: removing the grant tables breaks ~25 files at once, and `npm run typecheck` will not pass until every consumer is updated. There is no safe partial commit. Execute the whole plan, then typecheck + commit once.

**Goal:**
1. Flows become **workspace-scoped** (`jm_workflows.workspace_id`), replacing the grant-derived `scope/orgId/ownerUserId` model.
2. Workflow instances snapshot a **`workspace_id`**, replacing `workflow_scope_snapshot`.
3. **Delete** `jm_workflow_grants` and `jm_workflow_instance_grants` (tables, stores, interfaces, routes). Access control moves to workspace membership (`requireWorkspacePermission`).
4. **Wire the runtime `workspaceId`** from the instance snapshot → Conductor input → worker ctx → secret/skill/mcp resolvers. This lights up the workspace-tier resolution that 2a/2c/2d/2e deferred.

**Branch:** `feat/workspace-scoping-phase-2b`. **Migration:** `054`. **Clean break:** delete all existing flows/versions/instances/grants.

**Execution mode:** inline by a strong model (judgment-heavy: interface removals, access-control redesign, worker wiring). Batched — all edits, one `npm run migrate`, one `npm run typecheck` + `check:boundaries`, one commit.

---

## A. Migration `054_flows_workspace_scope.sql`

```sql
-- 054_flows_workspace_scope.sql
-- Flows + instances become workspace-scoped; grant tables removed. Clean break.

-- Drop dependent grant tables first.
DROP TABLE IF EXISTS jm_workflow_instance_grants;
DROP TABLE IF EXISTS jm_workflow_grants;

-- Clean break: existing flows/versions/instances carry no workspace.
DELETE FROM jm_workflow_instances;
DELETE FROM jm_workflow_versions;
DELETE FROM jm_workflows;

-- Flows: add workspace_id, drop legacy owner tombstone.
ALTER TABLE jm_workflows DROP COLUMN IF EXISTS owner_user_id;
ALTER TABLE jm_workflows
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_jm_workflows_workspace ON jm_workflows (workspace_id);

-- Instances: replace scope snapshot with workspace_id.
ALTER TABLE jm_workflow_instances DROP COLUMN workflow_scope_snapshot;
ALTER TABLE jm_workflow_instances
  ADD COLUMN workspace_id UUID REFERENCES jm_workspaces(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jm_workflow_instances_workspace ON jm_workflow_instances (workspace_id);
```

## B. Core types (`packages/core/src/`)

- `types/flow.types.ts`: delete `WorkflowScope`, `WorkflowGrantPrincipalType`, `WorkflowGrantRole`, `WorkflowGrant`. `Workflow`: drop `scope`/`orgId`/`ownerUserId`/`grants`; add `workspaceId: string`.
- `types/workflow-instance.types.ts`: `WorkflowInstance` — drop `workflowScopeSnapshot` and `effectiveRole`; add `workspaceId: string | null`.
- `types/workflow-instance-grants.types.ts`: delete the file (and its re-exports from `index.ts`). Keep `ActorContext`/`WorkflowInstanceListScope` ONLY if still used elsewhere; otherwise delete. (Grep before deleting.)
- `interfaces/workflow-store.interface.ts`: remove `IWorkflowGrantsStore`; update `IWorkflowStore` `CreateWorkflowArgs` to `{ workspaceId, name, description?, initialDefinition, createdByUserId }` (drop `scope`/`orgId`/`ownerUserId`); `WorkflowListFilter` → `{ workspaceId }`.
- `interfaces/workflow-instance-grants-store.interface.ts`: delete; remove from `index.ts`.
- `interfaces/orchestrator-engine.interface.ts`: `SubmitWorkflowInstanceArgs` / `CreateWorkflowInstanceArgs` — drop `workflowScopeSnapshot` + `startedByOrgId`-for-grants; add `workspaceId: string | null`.
- `index.ts`: remove all deleted exports.

## C. Orchestrator stores (`packages/orchestrator/src/stores/postgres/`)

- `postgres-flow-store.ts`: `create()` writes `workspace_id` directly (no owner grant); delete `hydrateFromOwnerGrant`; `getById`/`list`/`count` select `workspace_id` and filter `WHERE workspace_id = $1` (filter from `WorkflowListFilter.workspaceId`); remove all `jm_workflow_grants` references and the `grants` store dependency.
- **Delete** `postgres-flow-grants-store.ts` and `postgres-workflow-instance-grants-store.ts`.
- `postgres-workflow-instance-store.ts`: `create()` writes `workspace_id` (from args), drops `workflow_scope_snapshot`; `buildListQuery`/list filters by `workspace_id` (parameter), removing the `jm_workflow_instance_grants` LATERAL join and `grantMatchSql`. List scope = "instances in this workspace".

## D. Orchestrator engine + actions

- `engines/conductor/conductor-orchestrator.ts`: `submit()`/`runStart()` — accept `workspaceId`, pass it into `client.startWorkflow({ input: { ...startedByUserId, startedByOrgId, workflowId, workspaceId } })`; **remove** the `workflowInstanceGrants.createForInstance(user owner + org viewer)` calls and the grants-store dependency.
- `actions/fork.ts`, `actions/rerun.ts`: carry `workspaceId: instance.workspaceId` instead of `workflowScopeSnapshot`.
- `workers/worker-harness.ts`: in `processOnce()` extract `const workspaceId = stepInput.workspaceId ?? null;` alongside userId/orgId; add `workspaceId` to the ctx objects passed to `bindingResolver`, `mcpResolver`, `skillsResolver` (ctx type gains `workspaceId: string | null`).
- `cli-worker.ts`: `bindingResolver` — set `runCtx.workspace = workspaceId ? { id: workspaceId, orgId: ctx.orgId ?? "", role: null, permissions: [] } : undefined`. `mcpResolver`/`skillsResolver` — pass `{ workspaceId: ctx.workspaceId ?? null }` (the cast hack can become a real field now).

## E. API server

- **Delete** `services/flow-access.ts` and `routes/flow-grants.ts`.
- `composition.ts`: remove `IWorkflowGrantsStore` + `IWorkflowInstanceGrantsStore` from `Composition` and their wiring.
- `routes/flows.ts`: re-mount under `/api/workspaces/:wsId/workflows`, guarded by `makeRequireAuth` + `makeRequireWorkspacePermission`:
  - create → `resource.write`; list/get/versions → `resource.read`; update/publish/unpublish → `resource.write`; delete → `resource.delete`; start instance → `resource.write` (or read+run — choose `resource.write`).
  - `create` passes `workspaceId: wsId`; drop `canCreateAtScope`/`scope` body field.
  - start-instance (`POST .../workflows/:id/workflow-instances`): pass `workspaceId: workflow.workspaceId` and `workspaceId` into `submit()`; drop `workflowScopeSnapshot`.
  - **Delete** `/clone` cross-scope logic and `/promote` (no scopes). A within-workspace `/clone` MAY stay (clones into same `wsId`); if kept, simplify to copy within workspace. Otherwise remove.
  - Remove all `canRead/canEdit/canDelete/canPromoteTo` calls (the `requireWorkspacePermission` guard replaces them).
- `services/webhook-trigger-fire.ts` and `services/form-submission.ts`: pass `workspaceId: workflow.workspaceId` into `submit()`; drop `workflowScopeSnapshot`/`startedByOrgId`-for-grants.

## F. Agents (`packages/agents/src/run-agent.ts`)

`run-agent.ts` passes `agent.scope` as `workflowScopeSnapshot`. Agents are not yet workspace-scoped (2g). **Interim:** pass `workspaceId: null` (agent runs resolve org-tier secrets only until 2g), drop `workflowScopeSnapshot`. Add a `// TODO(agents cutover 2g): use agent.workspaceId`.

## G. Builder (`packages/builder/src/apply/apply.ts`)

`apply.ts` creates a workflow with `scope`. Change to pass `workspaceId: args.workspaceId` (already threaded for custom steps in 2e) and drop `scope`. Update `intent-schema.ts`/`examples.ts`/tests if they set a flow `scope`.

## H. Flow-editor (`packages/flow-editor/src/create-wizard/`)

- `wizard-state.ts`: drop `scope: WorkflowScope` from wizard state.
- `steps/BasicDetailsStep.tsx`: remove the scope picker UI.
- `CreateFlowWizard.tsx`: drop `allowedScopes`. The created workflow's workspace comes from the active workspace (Phase 3 switcher); for now the create call posts to `/api/workspaces/:wsId/workflows` with the current wsId (the web caller supplies it — see §I).

## I. Web (`packages/web/src/`) — keep compiling; full UX polish is Phase 3 §9b

- `api/flows.ts`: `listFlows`/`createFlow` keyed by `wsId` (workspace) not scope/orgId; drop `publishFlow` scope args stay; `Workflow` type drops `scope`/`orgId`, adds `workspaceId`. `api/flow-grants.ts`: delete `promoteFlow`; `cloneFlow`/`deleteFlow` keyed by wsId; delete the file if it only held grant/promote calls.
- `FlowsListPage.tsx`: drop scope tabs / `scopeBadge` / promote buttons / `canPromote`. List the active workspace's flows.
- `AdminFlowsPage.tsx`: either delete (folded into FlowsListPage per §9b) or make it list the workspace's flows without scope. Minimal: keep it compiling.
- `RunsListPage.tsx` + `packages/runs-list/src/RunsList.tsx`: drop the `workflowScopeSnapshot` badge (or show workspace name). Minimal: remove the scope badge.
- `RunDetailPage.tsx`: remove `workflowScopeSnapshot` read.
- These web edits are MINIMAL (keep typecheck green); the polished single-workspace pages + switcher are Phase 3.

## J. Verify + commit (once)

```bash
npm run migrate
npm run typecheck            # must be clean across ALL workspaces
npm run check:boundaries
npm test -w @journeyman/orchestrator   # conductor-orchestrator.runStart.test.ts updated to drop grants + add workspaceId
git checkout feat/workspace-scoping-phase-2b
git add -A
git commit -m "feat(flows): workspace-scoped flows + instances; remove grants; wire runtime workspaceId (migration 054)"
```

## Tests to update
- `orchestrator/src/engines/conductor/conductor-orchestrator.runStart.test.ts`: drop grant-creation assertions; assert `workspaceId` passed into `startWorkflow` input; fixture uses `workspaceId` not `workflowScopeSnapshot`.

---

## Big win delivered by this phase
After 2f, a run started from a workspace flow carries `workspace_id` end-to-end, so the worker's `mcpResolver`/`skillsResolver`/`bindingResolver` finally receive a real `workspaceId` — workspace-tier secrets/skills/MCP resolve at runtime (the deferred behavior from 2a/2c/2d/2e). Verify with a smoke run after merge.

## Sequencing note
2f is the natural place to also re-confirm 2a's secret runtime path (now non-null workspace). Agents (2g) still pass `workspaceId: null` until their own cutover — acceptable intermediate.
