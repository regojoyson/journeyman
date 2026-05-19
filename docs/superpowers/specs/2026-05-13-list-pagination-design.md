# Pagination for Workflow Instances and Workflows

**Date:** 2026-05-13
**Status:** Approved (autonomous, user requested no clarifying questions)

## Goal

Add server-side pagination to the two large list views in the product:

1. **Workflow Instances** (runs) — `GET /workflow-instances`
2. **Workflows** (flows) — `GET /workflows`

Both views are currently unbounded (or bounded only by a soft `limit`), which scales poorly. The UI also has no way for users to page through older rows.

## Scope

In scope:

- Server: paginated `list()` on `IWorkflowInstanceStore` and `IWorkflowStore` (postgres + memory).
- Server routes: accept `page`, `page_size`; return `{ items, total, page, pageSize }`.
- Web API clients: `listRuns`, `listFlows` return `{ items, total, page, pageSize }`.
- UI: pagination footer in `WorkflowInstancesList` (runs-list pkg) and `FlowsListPage`.
- Reset page to 1 when filters/scope change.

Out of scope:

- Cursor-based pagination (offsets are fine at expected row counts).
- Server-side sorting changes (existing `ORDER BY started_at DESC NULLS LAST` and workflow ordering remain).
- Pagination for any other lists (executions, events, grants, MCP instances, skills).

## API contract

### Request (query string)

| Param       | Type   | Default | Notes                          |
|-------------|--------|---------|--------------------------------|
| `page`      | int    | `1`     | 1-based                        |
| `page_size` | int    | `25`    | Max `100`, clamped server-side |

Existing filters (`status`, `workflow_id`, `provider`, `issue_ref`, `scope`, etc.) continue to work and stack with pagination. Legacy `limit` param is ignored if `page_size` is present; left in place as a deprecated alias for one release.

### Response

```json
{
  "workflowInstances": [...],  // or "workflows" for /workflows
  "total":     123,
  "page":      1,
  "pageSize":  25
}
```

`total` is the total matching rows for the current filters, ignoring pagination.

## Store interface change

```ts
interface PageOpts { offset?: number; limit?: number; }
interface PageResult<T> { items: T[]; total: number; }

IWorkflowInstanceStore.list(opts: { ...existing, offset?, limit? }): Promise<PageResult<WorkflowInstance>>
IWorkflowStore.list(filter: WorkflowListFilter & { offset?, limit? }): Promise<PageResult<Workflow>>
```

Both implementations (postgres + memory) compute `total` with a parallel `COUNT(*)` query (or `.length` for memory) using the same WHERE clause as the page query.

## UI

Add `<Pagination>` component (shared, lives in `packages/runs-list/src/Pagination.tsx` for now; `FlowsListPage` imports it directly):

```
[< Prev] Page 2 of 7 (153 results) [Next >]   Page size: [25 ▼]
```

- `Prev`/`Next` disabled at boundaries.
- Page-size selector: `10`, `25`, `50`, `100`. Persists in component state only (not localStorage in v1).
- Filter/scope changes call `setPage(1)`.

## File touch list

- `packages/core/src/interfaces/workflow-instance-store.interface.ts`
- `packages/core/src/interfaces/workflow-store.interface.ts`
- `packages/orchestrator/src/stores/postgres/postgres-workflow-instance-store.ts`
- `packages/orchestrator/src/stores/memory/memory-workflow-instance-store.ts`
- `packages/coding-models/src/...` (workflow store impls — if separate)
- `packages/api-server/src/routes/workflow-instances.ts`
- `packages/api-server/src/routes/flows.ts`
- `packages/web/src/api/runs.ts`
- `packages/web/src/api/flows.ts`
- `packages/web/src/routes/RunsListPage.tsx`
- `packages/web/src/routes/FlowsListPage.tsx`
- `packages/runs-list/src/types.ts`
- `packages/runs-list/src/RunsList.tsx`
- `packages/runs-list/src/Pagination.tsx` (new)
- `packages/runs-list/src/index.ts`

## Testing

- Manual: load each page, change filters, change page size, verify total updates.
- Type-check: `npm run typecheck` must pass repo-wide.
