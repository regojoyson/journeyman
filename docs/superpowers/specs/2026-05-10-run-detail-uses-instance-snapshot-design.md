# Run Detail Uses Instance Snapshot — Design

**Date:** 2026-05-10
**Status:** Approved

## Problem

`RunDetailPage` fetches the workflow version by id to render the run viewer
([packages/web/src/routes/RunDetailPage.tsx:24-30](../../../packages/web/src/routes/RunDetailPage.tsx)):

```ts
const versionId = detailQ.data?.workflowInstance.workflowVersionId;
const versionQ = useQuery({
  queryKey: ["flow-version-by-id", versionId],
  queryFn: () => getWorkflowVersionById(versionId!),
  enabled: !!versionId,
});
...
if (versionQ.isLoading || !versionQ.data) {
  return <div>Loading flow definition…</div>;
}
```

Two issues:

1. **Stale / incorrect.** Workflows can be edited after an instance is created.
   Fetching the version row shows the *current* definition of that version,
   but the instance may have run against earlier in-flight state, and
   conceptually the run detail should always show what actually executed.
2. **Breaks on workflow delete.** Schema has
   `jm_workflow_instances.workflow_version_id REFERENCES jm_workflow_versions(id)
   ON DELETE SET NULL` and `workflow_id ... ON DELETE SET NULL`
   ([004_flow_scopes.sql:85,118](../../../packages/migrations/src/sql/004_flow_scopes.sql)).
   When the workflow is deleted, versions cascade-delete, the instance row
   stays, and `workflowVersionId` becomes `NULL`. Then `enabled: !!versionId`
   is false, the query never resolves, and the page is stuck on
   "Loading flow definition…" forever.

The instance already carries `definitionSnapshot: WorkflowGraph`
([core/types/workflow-instance.types.ts:20](../../../packages/core/src/types/workflow-instance.types.ts))
and `workflowNameSnapshot: string` — the orchestrator runs against the
snapshot, not the version row. The page should use those.

## Goals

- Run detail renders from `workflowInstance.definitionSnapshot`, not from a
  separate version fetch.
- Instances of deleted workflows render fully, with a small "(workflow
  deleted)" marker on the title so users know why they can't navigate back to
  the editor.
- No regression for the common case (workflow still exists).

## Non-goals

- Schema changes. The `ON DELETE SET NULL` behavior is already correct.
- Rerun / fork behavior. `actions.rerun` already falls back to
  `original.definitionSnapshot` when `workflowVersionId` is null
  ([orchestrator/actions/rerun.ts:26-28](../../../packages/orchestrator/src/actions/rerun.ts)).
- Runs list page. Doesn't depend on the workflow row; already fine.
- Removing the `getWorkflowVersionById` API endpoint or web client function —
  out of scope; other callers may exist.

## Design

Surgical change to `packages/web/src/routes/RunDetailPage.tsx`:

1. Drop the `versionId` derivation, the `versionQ` `useQuery`, and the
   `getWorkflowVersionById` import.
2. Drop the "Loading flow definition…" early return.
3. Update the `RunViewer` props to source from the instance:

   ```tsx
   workflow={detailQ.data.workflowInstance.definitionSnapshot}
   workflowName={
     detailQ.data.workflowInstance.workflowNameSnapshot
     + (detailQ.data.workflowInstance.workflowVersionId ? "" : " (workflow deleted)")
   }
   ```

That's the entire change. The instance payload is already on the wire from
`getRun` — no API change needed.

## Edge cases

| Scenario                                  | Behavior                                                    |
| ----------------------------------------- | ----------------------------------------------------------- |
| Workflow exists, version exists           | Same definition rendered (sourced from snapshot now).       |
| Workflow edited after instance ran        | Instance now shows what ran, not the latest definition.    |
| Workflow deleted                          | Instance renders fully; title appends "(workflow deleted)". |
| Pre-migration-004 instance (empty snapshot) | Won't happen — `definition_snapshot` is `NOT NULL` since 004. |

## Verification

Manual smoke test:

- Open a run for an existing workflow → renders identically to today.
- Edit the workflow's definition (in a draft) → reopen the run → it still
  shows the original definition the instance ran against.
- Delete a workflow that has at least one instance → open the instance from
  the runs list → renders fully; title shows "(workflow deleted)".
