# Workflow-list Run action — design

**Date:** 2026-06-22
**Status:** Approved (brainstorm)
**Scope:** Add a per-row **Run** action to the workflow list page that runs a published workflow, reusing the existing `RunFlowDialog`.

## Problem

`FlowsListPage` ([packages/web/src/routes/FlowsListPage.tsx](../../../packages/web/src/routes/FlowsListPage.tsx)) lists workflows with a status chip and Edit/Rename actions, but offers no way to run one. Running today requires opening the editor (topbar Run) or the Runs page's "New run" dialog (which makes the user re-select the workflow from a dropdown). Users want to run a published workflow directly from the list.

## Goal

From the workflow list, clicking **Run** on a published workflow opens the same inputs dialog used by the editor, collects the workflow's configured inputs, submits the run, and navigates to the live run view.

## Constraints (pinned by existing system)

- The run route `POST /workspaces/:wsId/workflows/:id/workflow-instances` requires `resource.write` and rejects unless the workflow is **ready** (published) with a published version and a manual-trigger node ([packages/api-app/src/routes/flows.ts](../../../packages/api-app/src/routes/flows.ts)). So Run is meaningful only for published workflows and only for editors.
- `RunFlowDialog` ([packages/web/src/components/RunFlowDialog.tsx](../../../packages/web/src/components/RunFlowDialog.tsx)) already exists as a standalone, presentational component: props `{ wsId, workflowId, workflowName, inputDefs, onClose, onSubmitted? }`. It renders typed inputs, validates required fields, calls `runFlow`, and navigates to the run view when `onSubmitted` is omitted.

## Design

### Visibility

Render a **Run** action in the existing Actions column, shown only when `editable && f.status === "ready"`. Drafts show no Run (consistent with the editor gate and the backend's published-only rule). `editable` is the page's existing `can("resource.write")`.

### Component reuse

Reuse `RunFlowDialog` unchanged — no new dialog, no duplication. This is the explicit intent: the list and the editor present the identical run experience.

### Data flow (lazy, per row)

1. User clicks **Run** on a `ready` row → set `runTarget = { id, name }`.
2. Fetch that workflow's published version: `getCurrentWorkflowVersion(wsId, id)` ([packages/web/src/api/flows.ts](../../../packages/web/src/api/flows.ts)).
3. Derive `inputDefs` with the same resolution the editor uses: `version.inputDefs` if present, else `getStartWorkflowInputs(startNode.config)` (reads `config.workflowInputs`). Filter out blank-named defs.
4. Render `RunFlowDialog` with `{ wsId, workflowId: id, workflowName: name, inputDefs }`.
5. On submit, the dialog calls `runFlow` and (default behavior) navigates to `/workspaces/:wsId/workflow-instances/:instanceId`.

While step 2 is in flight, do not mount the dialog with empty defs (avoid a misleading "no inputs" flash); show the dialog only once the version resolves (mirror the editor's `!runVersionQ.isLoading` guard).

### State added to `FlowsListPage`

- `runTarget: { id: string; name: string } | null`
- `runInputDefs: WorkflowInputDef[]`
- a loading flag for the version fetch
- `useNavigate` for post-submit navigation

The list itself uses plain `useState`/`fetch` today; the version fetch on Run click follows that same plain-async style (no react-query needed).

## Out of scope (YAGNI)

- No change to the Runs/instances page "New run" dialog (`NewRunDialog`) — different surface.
- No change to `RunFlowDialog` or `runFlow`.
- No backend changes.

## Error handling

- Version fetch failure → surface an inline error (reuse the page's existing `error`/`alert` pattern) and do not open the dialog.
- Run submit failure → handled inside `RunFlowDialog` (shows the error, keeps the dialog open).
- Backend rejects a non-ready/triggerless workflow with 409; since Run is gated on `status === "ready"`, this is defense-in-depth and surfaces as the dialog's error text.

## Testing

- Render test on `FlowsListPage`: a `ready` row shows **Run**; a `draft` row does not; a `ready` row for a read-only (non-`editable`) user does not.
- `RunFlowDialog` behavior is already covered by [packages/web/src/components/RunFlowDialog.test.tsx](../../../packages/web/src/components/RunFlowDialog.test.tsx).

## Related (not part of this spec)

A separate fix corrected the editor's Run gate (`runEnabled` had contradictory `!effectiveReadOnly` + `status !== "draft"`). That lives in `FlowEditor.tsx` and is independent of this list-page work, which uses its own row-level `status === "ready"` condition.
