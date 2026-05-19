# Design: Rename `flow`/`run` → `workflow`/`WorkflowInstance`

**Date:** 2026-05-07  
**Status:** Approved

---

## Context

The codebase uses two paired concepts:
- **Flow** — a reusable definition (blueprint) of an automated process
- **Run** — a single execution instance of a flow

The current names ("flow", "run") are informal and don't match the vocabulary of the underlying orchestration engine (Conductor), which uses "workflow" for definitions and "workflow instance" for executions.

The goal is to align the entire system — DB schema, TypeScript types, API routes, and frontend UI — on a single, consistent vocabulary:
- `flow` → `workflow`
- `run` → `WorkflowInstance`

This is a pure rename with no behavioral changes.

---

## Naming Map

| Current | New |
|---|---|
| `Flow` | `Workflow` |
| `FlowVersion` | `WorkflowVersion` |
| `FlowGraph` | `WorkflowGraph` |
| `RunInputDef` | `WorkflowInputDef` |
| `Run` | `WorkflowInstance` |
| `RunStatus` | `WorkflowInstanceStatus` |
| `RunEvent` | `WorkflowInstanceEvent` |
| `RunEventType` | `WorkflowInstanceEventType` |
| `RunGrant` | `WorkflowInstanceGrant` |
| `RunGrantRole` | `WorkflowInstanceGrantRole` |
| `RunGrantPrincipalType` | `WorkflowInstanceGrantPrincipalType` |
| `RunListScope` | `WorkflowInstanceListScope` |
| `CreateRunGrantArgs` | `CreateWorkflowInstanceGrantArgs` |
| `IRunStore` | `IWorkflowInstanceStore` |
| `IRunGrantsStore` | `IWorkflowInstanceGrantsStore` |
| `SubmitRunArgs` | `SubmitWorkflowInstanceArgs` |
| `CreateRunArgs` | `CreateWorkflowInstanceArgs` |
| `PostgresRunStore` | `PostgresWorkflowInstanceStore` |
| `MemoryRunStore` | `MemoryWorkflowInstanceStore` |
| `PostgresRunGrantsStore` | `PostgresWorkflowInstanceGrantsStore` |
| `RunSyncer` | `WorkflowInstanceSyncer` |
| Event string `"run.started"` | `"workflow_instance.started"` |
| Event string `"run.completed"` | `"workflow_instance.completed"` |
| Event string `"run.failed"` | `"workflow_instance.failed"` |
| Event string `"run.cancelled"` | `"workflow_instance.cancelled"` |
| Route `/runs` | `/workflow-instances` |
| Route `/flows` | `/workflows` |
| Response key `{ runs }` | `{ workflowInstances }` |
| Response key `{ run }` | `{ workflowInstance }` |
| Response key `{ flows }` | `{ workflows }` |
| Response key `{ flow }` | `{ workflow }` |

**Note:** The status value `"running"` inside `WorkflowInstanceStatus` is preserved as-is — it is a plain English adjective describing state, not a reference to the old "run" concept.

---

## Database Changes

**New migration:** `packages/migrations/src/sql/020_rename_flows_runs.sql`

### Table renames
```sql
ALTER TABLE jm_flows            RENAME TO jm_workflows;
ALTER TABLE jm_flow_versions    RENAME TO jm_workflow_versions;
ALTER TABLE jm_runs             RENAME TO jm_workflow_instances;
ALTER TABLE jm_run_events       RENAME TO jm_workflow_instance_events;
ALTER TABLE jm_run_grants       RENAME TO jm_workflow_instance_grants;
-- jm_node_executions: no rename needed
```

### Column renames
```sql
-- jm_workflow_versions
ALTER TABLE jm_workflow_versions RENAME COLUMN flow_id TO workflow_id;

-- jm_workflow_instances
ALTER TABLE jm_workflow_instances RENAME COLUMN flow_id TO workflow_id;
ALTER TABLE jm_workflow_instances RENAME COLUMN flow_version_id TO workflow_version_id;
ALTER TABLE jm_workflow_instances RENAME COLUMN flow_name_snapshot TO workflow_name_snapshot;
ALTER TABLE jm_workflow_instances RENAME COLUMN flow_scope_snapshot TO workflow_scope_snapshot;

-- jm_workflow_instance_events
ALTER TABLE jm_workflow_instance_events RENAME COLUMN run_id TO workflow_instance_id;

-- jm_workflow_instance_grants
ALTER TABLE jm_workflow_instance_grants RENAME COLUMN run_id TO workflow_instance_id;

-- jm_node_executions
ALTER TABLE jm_node_executions RENAME COLUMN run_id TO workflow_instance_id;
```

### Index renames
```sql
ALTER INDEX jm_runs_status_idx          RENAME TO jm_workflow_instances_status_idx;
ALTER INDEX jm_runs_engine_wfid_idx     RENAME TO jm_workflow_instances_engine_wfid_idx;
ALTER INDEX jm_runs_flow_version_idx    RENAME TO jm_workflow_instances_workflow_version_idx;
ALTER INDEX jm_runs_flow_id_idx         RENAME TO jm_workflow_instances_workflow_id_idx;
ALTER INDEX jm_runs_webhook_event_idx   RENAME TO jm_workflow_instances_webhook_event_idx;
ALTER INDEX jm_run_events_run_idx       RENAME TO jm_workflow_instance_events_idx;
ALTER INDEX idx_jm_run_grants_run       RENAME TO idx_jm_workflow_instance_grants_instance;
ALTER INDEX idx_jm_run_grants_principal RENAME TO idx_jm_workflow_instance_grants_principal;
```

Pure rename migration — no data changes, no downtime risk.

---

## TypeScript Changes

### `packages/core/src/types/`
- `flow.types.ts` — rename `Flow` → `Workflow`, `FlowVersion` → `WorkflowVersion`, `FlowGraph` → `WorkflowGraph`, `RunInputDef` → `WorkflowInputDef`
- `run.types.ts` → `workflow-instance.types.ts` — rename all `Run*` symbols to `WorkflowInstance*`
- `run-grants.types.ts` → `workflow-instance-grants.types.ts` — rename all `RunGrant*` symbols to `WorkflowInstanceGrant*`

### `packages/core/src/interfaces/`
- `run-store.interface.ts` → `workflow-instance-store.interface.ts`
- `run-grants-store.interface.ts` → `workflow-instance-grants-store.interface.ts`
- `orchestrator-engine.interface.ts` — update `SubmitRunArgs` → `SubmitWorkflowInstanceArgs`

### `packages/orchestrator/src/`
- Rename store classes and their files (`postgres-run-store.ts` → `postgres-workflow-instance-store.ts`, etc.)
- Update `RunSyncer` → `WorkflowInstanceSyncer`
- Update all internal references in action files (`rerun.ts`, `fork.ts`, etc.)

### `packages/flow-editor/src/`
- `RunInputsEditor.tsx` → `WorkflowInputsEditor.tsx`
- All internal references to `Flow`/`Run` types updated

### `packages/coding-cli/src/`
- Update any references to `Flow`/`Run` types imported from `@journeyman/core`

---

## API Changes

### `packages/api-server/src/routes/`
- `runs.ts` → `workflow-instances.ts`
- All endpoints updated: `/runs` → `/workflow-instances`, `/runs/:id` → `/workflow-instances/:id`
- `flows.ts` — all `/flows` → `/workflows`
- Response shapes: `{ run }` → `{ workflowInstance }`, `{ runs }` → `{ workflowInstances }`, `{ flow }` → `{ workflow }`, `{ flows }` → `{ workflows }`

### `packages/web/src/api/`
- `runs.ts` → `workflow-instances.ts` — all functions renamed (`listRuns` → `listWorkflowInstances`, `getRun` → `getWorkflowInstance`, `rerunRun` → `rerunWorkflowInstance`, etc.)
- `flows.ts` — all function names updated

---

## Frontend Changes

### `packages/web/src/`
- `routes/RunsListPage.tsx` → `WorkflowInstancesPage.tsx`
- `routes/RunDetailPage.tsx` → `WorkflowInstanceDetailPage.tsx`
- `components/RunSubmittedToast.tsx` → `WorkflowInstanceSubmittedToast.tsx`
- `components/Sidebar.tsx` — label "Runs" → "Workflow Instances", "Flows" → "Workflows"
- `hooks/useRunActions.ts` → `useWorkflowInstanceActions.ts`

### Package renames
- `packages/run-viewer/` → `packages/workflow-instance-viewer/`
  - npm package: `@journeyman/run-viewer` → `@journeyman/workflow-instance-viewer`
- `packages/runs-list/` → `packages/workflow-instances-list/`
  - npm package: `@journeyman/runs-list` → `@journeyman/workflow-instances-list`
- Update all `package.json` dependency references across the monorepo

---

## Implementation Order

Execute in this sequence to keep the repo compilable at each step:

1. **DB migration** — add and deploy `020_rename_flows_runs.sql` before any code ships
2. **`@journeyman/core`** — rename all types and interfaces (every other package depends on this)
3. **`packages/orchestrator`** — update store implementations and engine bindings
4. **`packages/api-server`** — update routes and response shapes
5. **`packages/web/src/api/`** — update API client functions
6. **`packages/web/src/routes/` and `components/`** — update pages, components, sidebar
7. **`packages/flow-editor`** — update `WorkflowInputsEditor`
8. **Package renames** — rename `run-viewer` and `runs-list` packages, update all `package.json` references
9. **Typecheck** — `npm run typecheck` across all packages to catch any missed references

---

## Verification

- `npm run typecheck` passes with zero errors across all packages
- DB migration runs cleanly on a local Postgres instance
- Sidebar shows "Workflows" and "Workflow Instances" navigation labels
- `/workflow-instances` list page loads and displays existing records
- `/workflow-instances/:id` detail page loads correctly
- Creating a new workflow instance (triggering a workflow) works end-to-end
- SSE event stream at `/workflow-instances/:id/events` delivers events correctly
- No references to old names remain (grep for `jm_runs`, `jm_flows`, `IRunStore`, `RunStatus`, `"/runs"`)
