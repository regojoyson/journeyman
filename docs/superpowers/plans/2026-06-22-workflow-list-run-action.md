# Workflow-list Run action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-row **Run** action to the workflow list that runs a published workflow via the existing `RunFlowDialog`.

**Architecture:** Pure-function visibility helper gates a `Run` button in `FlowsListPage`'s Actions column (`editable && status === "ready"`). Clicking lazily fetches the workflow's published version, resolves its typed inputs, and opens the shared `RunFlowDialog`, which submits via `runFlow` and navigates to the live run view.

**Tech Stack:** React + TypeScript, react-router-dom, Vitest (`renderToStaticMarkup` style tests), `@journeyman/core` types.

**Execution constraints (from user):** Work on `master` directly (no branch/worktree). **No commits** — leave all changes in the working tree. Run typecheck (and the new unit test) only at the end.

---

## File Structure

- **Create** `packages/web/src/routes/flows-list-actions.ts` — pure helper `runActionVisible(editable, status)`. One responsibility: the row-level Run visibility rule, isolated so it is unit-testable without rendering the async list page.
- **Create** `packages/web/src/routes/flows-list-actions.test.ts` — unit tests for the helper.
- **Modify** `packages/web/src/routes/FlowsListPage.tsx` — wire the Run button, the lazy version fetch, and the `RunFlowDialog` mount.

Reused unchanged: `packages/web/src/components/RunFlowDialog.tsx`, `getCurrentWorkflowVersion`/`runFlow` in `packages/web/src/api/flows.ts`, `getStartWorkflowInputs` in `@journeyman/core`.

> **Testing note:** `FlowsListPage` loads rows via an async `useEffect` fetch, so a `renderToStaticMarkup` test only ever sees the "Loading…" state — it cannot assert rows. The spec's three visibility cases are therefore covered by unit-testing the extracted `runActionVisible` helper instead of rendering the page.

---

### Task 1: Run-action visibility helper

**Files:**
- Create: `packages/web/src/routes/flows-list-actions.ts`
- Test: `packages/web/src/routes/flows-list-actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/routes/flows-list-actions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runActionVisible } from "./flows-list-actions.ts";

describe("runActionVisible", () => {
  it("shows Run for an editable, published workflow", () => {
    expect(runActionVisible(true, "ready")).toBe(true);
  });

  it("hides Run for a draft workflow", () => {
    expect(runActionVisible(true, "draft")).toBe(false);
  });

  it("hides Run for a read-only user even when published", () => {
    expect(runActionVisible(false, "ready")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/web/src/routes/flows-list-actions.test.ts`
Expected: FAIL — cannot resolve `./flows-list-actions.ts` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `packages/web/src/routes/flows-list-actions.ts`:

```typescript
import type { WorkflowStatus } from "@journeyman/core";

/**
 * Whether the per-row Run action should appear in the workflow list.
 * Run is meaningful only for published workflows, and the run route
 * requires resource.write — so it shows only to editors of a ready flow.
 */
export function runActionVisible(editable: boolean, status: WorkflowStatus): boolean {
  return editable && status === "ready";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/src/routes/flows-list-actions.test.ts`
Expected: PASS (3 passed).

---

### Task 2: Wire the Run button + dialog into FlowsListPage

**Files:**
- Modify: `packages/web/src/routes/FlowsListPage.tsx`

- [ ] **Step 1: Update the imports**

Replace the existing import block at the top of `packages/web/src/routes/FlowsListPage.tsx` (lines 1-8):

```tsx
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Workflow } from "@journeyman/core";
import { listFlowsPaged, updateFlowMeta } from "../api/flows.ts";
import { useWorkspace } from "../WorkspaceContext.tsx";
import { Pagination } from "@journeyman/runs-list";
import { btnPrimary, card } from "./admin-styles.ts";
import { StatusChip } from "../components/StatusChip.tsx";
```

with:

```tsx
import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import type { Workflow, WorkflowInputDef } from "@journeyman/core";
import { getStartWorkflowInputs } from "@journeyman/core";
import { listFlowsPaged, updateFlowMeta, getCurrentWorkflowVersion } from "../api/flows.ts";
import { useWorkspace } from "../WorkspaceContext.tsx";
import { Pagination } from "@journeyman/runs-list";
import { btnPrimary, card } from "./admin-styles.ts";
import { StatusChip } from "../components/StatusChip.tsx";
import { RunFlowDialog } from "../components/RunFlowDialog.tsx";
import { runActionVisible } from "./flows-list-actions.ts";
```

- [ ] **Step 2: Add run state + navigate**

In `FlowsListPage`, immediately after the existing line `const [pageSize, setPageSize] = useState(25);`, add:

```tsx
  const navigate = useNavigate();
  const [runTarget, setRunTarget] = useState<{ id: string; name: string } | null>(null);
  const [runInputDefs, setRunInputDefs] = useState<WorkflowInputDef[]>([]);
  const [runLoadingId, setRunLoadingId] = useState<string | null>(null);
```

- [ ] **Step 3: Add the handleRun function**

Immediately after the existing `handleRename` function (which ends with its closing `}`), add:

```tsx
  async function handleRun(flow: Workflow) {
    setRunLoadingId(flow.id);
    setError(null);
    try {
      const version = await getCurrentWorkflowVersion(wsId, flow.id);
      const def = version.definition;
      const startNode = def.nodes.find(
        (n) => n.type === "trigger-manual" || n.type === "trigger-webhook" || n.type === "trigger-human",
      );
      const defs = (def.inputDefs && def.inputDefs.length > 0
        ? def.inputDefs
        : getStartWorkflowInputs(startNode?.config)
      ).filter((d) => d.name.trim() !== "");
      setRunInputDefs(defs);
      setRunTarget({ id: flow.id, name: flow.name });
    } catch (e) {
      setError(`Could not load inputs: ${(e as Error).message}`);
    } finally {
      setRunLoadingId(null);
    }
  }
```

- [ ] **Step 4: Add the Run button to the Actions cell**

In the Actions `<td>`, inside `<div className="flex flex-wrap gap-3 text-xs">`, immediately after the closing `)}` of the `editable ? ( … ) : ( … )` block (i.e. just before `</div>`), add:

```tsx
                        {runActionVisible(editable, f.status) && (
                          <button
                            onClick={() => handleRun(f)}
                            disabled={runLoadingId === f.id}
                            className="text-foreground hover:text-foreground"
                          >
                            {runLoadingId === f.id ? "Loading…" : "Run"}
                          </button>
                        )}
```

- [ ] **Step 5: Mount the RunFlowDialog**

Immediately after the `{!loading && !error && total > 0 && ( <Pagination … /> )}` block and before the closing `</div>` of the inner `<div className="w-full px-6 py-10 space-y-6">`, add:

```tsx
        {runTarget && (
          <RunFlowDialog
            wsId={wsId}
            workflowId={runTarget.id}
            workflowName={runTarget.name}
            inputDefs={runInputDefs}
            onClose={() => setRunTarget(null)}
            onSubmitted={(res) => {
              setRunTarget(null);
              navigate(`/workspaces/${wsId}/workflow-instances/${res.workflowInstanceId}`);
            }}
          />
        )}
```

> Note: `runTarget` is set only *after* the version fetch resolves (Step 3), so the dialog always opens with the correct `inputDefs` — no empty-form flash. The per-row "Loading…" label covers the fetch latency.

---

### Task 3: Verify (typecheck + unit test)

**Files:** none (verification only)

- [ ] **Step 1: Run the new unit test**

Run: `npx vitest run packages/web/src/routes/flows-list-actions.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 2: Typecheck the web package**

Run: `npm run typecheck --workspace @journeyman/web`
Expected: exits 0 with no `tsc` errors.

- [ ] **Step 3: Confirm no commit**

Per the user's constraint, do **not** commit. Leave all changes (`flows-list-actions.ts`, `flows-list-actions.test.ts`, `FlowsListPage.tsx`) in the working tree on `master`. Report the changed files with `git status --short`.

---

## Notes for the implementer

- `RunFlowDialog` already exists and is tested ([RunFlowDialog.test.tsx](../../../packages/web/src/components/RunFlowDialog.test.tsx)); do not modify it.
- The run route requires the workflow be published with a manual-trigger node; `runActionVisible` only gates on `status === "ready"`, so a published-but-triggerless workflow will surface a backend error inside the dialog (acceptable defense-in-depth).
- This plan is independent of the separate `FlowEditor.tsx` run-gate fix; do not touch `FlowEditor.tsx` here.
