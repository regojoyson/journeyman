# Hide draft flows in the "New Run" dropdown

## Problem

The "New Run" dialog on the Runs list page lets users pick *any* workflow, including drafts. Submitting a draft fails server-side with `409 workflow_not_ready` (see [`assert-flow-ready.ts:10`](../../../packages/api-server/src/services/assert-flow-ready.ts)), which is correct but produces a confusing dead-end UX: the dropdown advertises something the user can't actually run.

## Scope

One-file UX fix in `NewRunDialog` ([`RunsListPage.tsx:25`](../../../packages/web/src/routes/RunsListPage.tsx)). No backend, type, or API changes.

## Change

In `NewRunDialog`, extend the existing flow filter to also drop non-`ready` flows:

```ts
const flows: Workflow[] = (flowsQ.data ?? []).filter(
  f => f.status === "ready" && (isPlatformAdmin || f.scope !== "global"),
);
```

That's the entire change. Existing scope-grouping (`user` / `org` / `global` optgroups) and badge rendering are unaffected — they operate on the already-filtered `flows` array.

## What stays the same

- **Flows admin page** ([`AdminFlowsPage.tsx`](../../../packages/web/src/routes/AdminFlowsPage.tsx)) and the flow editor continue to show drafts — that's where you edit and publish them.
- **Backend gate** in `assertWorkflowReady` remains untouched; it stays as the authoritative defense against draft runs from any ingress (manual, webhook, scheduler, retry).
- **`listFlows()` API** is unchanged — filtering is purely client-side in the dropdown component. Other consumers (admin list) still see drafts.

## Explicitly out of scope

- No empty-state hint ("no published workflows…"). Users with only drafts will see just "— select a workflow —". If this comes up, it's a follow-up.
- No "Draft" badge / disabled option style in the dropdown. We hide rather than show-disabled.
- No change to the rerun path — re-running an existing instance doesn't go through this dropdown.

## Testing

Manual:
1. Create two workflows; publish one, leave the other in draft.
2. Open Runs page → "New Run". Confirm only the published one appears.
3. Set the published one back to draft. Confirm the dropdown is empty (only the placeholder option remains).

No automated test added — this is a one-line filter clause and the component has no existing unit-test harness for the dialog.
