# Run Detail Uses Instance Snapshot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the run detail page from the instance's `definitionSnapshot` instead of fetching a workflow version, so runs of edited or deleted workflows render correctly.

**Architecture:** Single-file change in `RunDetailPage.tsx`. Drop the `versionQ` `useQuery` and the `getWorkflowVersionById` import; source `workflow` and `workflowName` directly from `detailQ.data.workflowInstance.definitionSnapshot` and `workflowNameSnapshot`. Append "(workflow deleted)" to the title when `workflowVersionId` is null.

**Tech Stack:** React, `@tanstack/react-query`, `@journeyman/run-viewer`, `@journeyman/core` (`WorkflowInstance` type already carries `definitionSnapshot` and `workflowNameSnapshot`).

**Spec:** [docs/superpowers/specs/2026-05-10-run-detail-uses-instance-snapshot-design.md](../specs/2026-05-10-run-detail-uses-instance-snapshot-design.md)

---

### Task 1: Replace version fetch with instance snapshot

**Files:**
- Modify: `packages/web/src/routes/RunDetailPage.tsx` (lines 1-58 and 116-118)

- [ ] **Step 1: Remove the `getWorkflowVersionById` import**

In `packages/web/src/routes/RunDetailPage.tsx`, delete line 9:

```tsx
import { getWorkflowVersionById } from "../api/flow-versions.ts";
```

- [ ] **Step 2: Remove the `versionId` derivation and `versionQ` query**

Find this block (lines 24-30):

```tsx
  const versionId = detailQ.data?.workflowInstance.workflowVersionId;
  const isViewer = detailQ.data?.workflowInstance.effectiveRole === "viewer";
  const versionQ = useQuery({
    queryKey: ["flow-version-by-id", versionId],
    queryFn: () => getWorkflowVersionById(versionId!),
    enabled: !!versionId,
  });
```

Replace it with:

```tsx
  const isViewer = detailQ.data?.workflowInstance.effectiveRole === "viewer";
```

- [ ] **Step 3: Remove the "Loading flow definition…" early return**

Find this block (lines 56-58):

```tsx
  if (versionQ.isLoading || !versionQ.data) {
    return <div style={{ padding: 24, color: "#888" }}>Loading flow definition…</div>;
  }
```

Delete it entirely. The `detailQ.data` guard on line 55 already ensures `workflowInstance` is available before we render `RunViewer`.

- [ ] **Step 4: Source `RunViewer` props from the instance snapshot**

Find the `RunViewer` usage (lines 116-118):

```tsx
      <RunViewer
        workflow={versionQ.data.definition}
        workflowName={`Workflow v${versionQ.data.versionNumber}`}
```

Replace those two prop lines with:

```tsx
      <RunViewer
        workflow={detailQ.data.workflowInstance.definitionSnapshot}
        workflowName={
          detailQ.data.workflowInstance.workflowNameSnapshot
          + (detailQ.data.workflowInstance.workflowVersionId ? "" : " (workflow deleted)")
        }
```

Leave the other `RunViewer` props (`workflowInstance`, `events`, `executions`, the `on*` handlers) untouched.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS (no errors). If TypeScript flags `useQuery` as unused, also remove it from the `@tanstack/react-query` import — see Step 6.

- [ ] **Step 6: Tidy unused imports if needed**

`useQuery` is still used by `detailQ`, so the `@tanstack/react-query` import stays. No other imports become unused. If the typecheck in Step 5 surfaces an unused-import warning, remove that specific import.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/routes/RunDetailPage.tsx
git commit -m "fix(web): render run detail from instance snapshot, not workflow version"
```

---

### Task 2: Manual verification

No automated tests per spec. Verify three scenarios in the running preview.

- [ ] **Step 1: Existing workflow — regression check**

In the web app:
1. Open a run from the runs list whose workflow still exists and hasn't been edited since.
2. The page should render normally, with the run viewer showing the same definition as before.

Expected: identical rendering to pre-change. Title shows the workflow name from `workflowNameSnapshot` (previously it showed `Workflow v{N}`; the change in title text is intentional).

- [ ] **Step 2: Edited workflow — correctness improvement**

1. Take an existing draft workflow that has at least one prior run.
2. Edit and save the workflow definition (add or remove a node).
3. Open the prior run from the runs list.

Expected: the run viewer shows the *original* definition (the one that ran), not the edited one.

- [ ] **Step 3: Deleted workflow — bug fix**

1. Pick a workflow that has at least one instance.
2. Delete the workflow via `DELETE /workflows/:id` (e.g. via the workflows list UI delete action, or via curl with a valid auth cookie).
3. Open one of its instances from the runs list.

Expected:
- Page renders fully (no "Loading flow definition…" hang).
- Run viewer shows the definition the instance ran against.
- Title appends " (workflow deleted)".

- [ ] **Step 4: Spot-check rerun on deleted workflow**

While viewing the deleted-workflow instance from Step 3, click **Rerun**.

Expected: rerun succeeds, kicks off a new instance using `definitionSnapshot` (existing fallback in `packages/orchestrator/src/actions/rerun.ts:26-28` — no code change needed; we're confirming it still works end-to-end).

---

## Self-Review Notes

- **Spec coverage:**
  - "Drop the `versionId` derivation, the `versionQ` `useQuery`, and the `getWorkflowVersionById` import" → Task 1 Steps 1-2.
  - "Drop the 'Loading flow definition…' early return" → Task 1 Step 3.
  - "Update the `RunViewer` props to source from the instance" → Task 1 Step 4.
  - "(workflow deleted)" marker → Task 1 Step 4.
  - All four edge cases from the spec table → covered by Task 2 Steps 1-4 (pre-004 instances are not testable since the migration is already applied; the spec correctly notes this).
- **Placeholder scan:** No TBDs, all code shown verbatim, all commands explicit.
- **Type consistency:** `definitionSnapshot: WorkflowGraph` and `workflowNameSnapshot: string` match the type at `packages/core/src/types/workflow-instance.types.ts:18-20`. `workflowVersionId` is nullable (string | null) in the type, so the `? "" : " (workflow deleted)"` ternary handles both null and undefined.
- **Imports:** `useQuery` is still used by `detailQ` so the React Query import stays. No new imports needed; `WorkflowInstance` is already typed via `detailQ.data`.
