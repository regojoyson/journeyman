# Agent Run Lifecycle Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cancel/Stop, Pause, Resume, and Re-run controls to the agent run detail view (`/workspaces/:wsId/agent-runs/:runId`).

**Architecture:** Agent runs *are* workflow instances (same `jm_workflow_instances` table; the agent run's `id` is a workflow-instance id). The existing `/workflow-instances/:id/{cancel,pause,resume,rerun}` endpoints already operate on agent runs by id, so this is a **frontend-only** change. We add a small agent-specific presentational component for the buttons (status-gated, viewer-gated) and wire it into `AgentRunDetailPage` using the existing `api/runs.ts` functions, a local busy flag, a refetch, and agent-context re-run navigation.

**Tech Stack:** React + TypeScript, react-router, Vite, Vitest (`renderToStaticMarkup` for presentational tests), Tailwind.

**Execution constraints (from requester):**
- Work directly on the **master** branch — no new branch or worktree.
- **Do NOT commit** at any point. Leave changes in the working tree.
- Run **typecheck once at the very end** as the final gate (plus the one new unit test).

---

## File Structure

- **Create:** `packages/web/src/components/agents/AgentRunControls.tsx` — presentational button cluster; decides which buttons show from `status` + `canWrite`, calls passed callbacks. No data/IO.
- **Create:** `packages/web/src/components/agents/AgentRunControls.test.tsx` — unit test for status/permission gating (mirrors `SectionNav.test.tsx`).
- **Modify:** `packages/web/src/routes/AgentRunDetailPage.tsx` — refactor fetch into a reusable `load()`, add busy/error state + action handlers, render `<AgentRunControls>` in the header.

No backend, orchestrator, DB, `RunTopbar`, or workflow-instance-view changes.

---

## Task 1: `AgentRunControls` presentational component

**Files:**
- Create: `packages/web/src/components/agents/AgentRunControls.tsx`
- Test: `packages/web/src/components/agents/AgentRunControls.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/agents/AgentRunControls.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentRunControls } from "./AgentRunControls.tsx";

const noop = () => {};
const base = {
  busy: false,
  canWrite: true,
  onPause: noop,
  onResume: noop,
  onCancel: noop,
  onRerun: noop,
};

function html(status: string, over: Partial<typeof base> = {}) {
  return renderToStaticMarkup(<AgentRunControls status={status} {...base} {...over} />);
}

describe("AgentRunControls", () => {
  it("running → Pause + Cancel, no Resume/Re-run", () => {
    const h = html("running");
    expect(h).toContain("Pause");
    expect(h).toContain("Cancel");
    expect(h).not.toContain("Resume");
    expect(h).not.toContain("Re-run");
  });

  it("paused → Resume + Cancel, no Pause/Re-run", () => {
    const h = html("paused");
    expect(h).toContain("Resume");
    expect(h).toContain("Cancel");
    expect(h).not.toContain("Pause");
    expect(h).not.toContain("Re-run");
  });

  it("terminal (completed) → Re-run only, no Cancel/Pause/Resume", () => {
    const h = html("completed");
    expect(h).toContain("Re-run");
    expect(h).not.toContain("Cancel");
    expect(h).not.toContain("Pause");
    expect(h).not.toContain("Resume");
  });

  it("terminal (failed) → Re-run", () => {
    expect(html("failed")).toContain("Re-run");
  });

  it("cancelled is terminal → Re-run", () => {
    expect(html("cancelled")).toContain("Re-run");
  });

  it("renders nothing for viewers (canWrite=false)", () => {
    expect(html("running", { canWrite: false })).toBe("");
  });

  it("disables buttons while busy", () => {
    expect(html("running", { busy: true })).toContain("disabled");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @journeyman/web -- AgentRunControls`
Expected: FAIL — `Failed to resolve import "./AgentRunControls.tsx"` (file does not exist yet).

- [ ] **Step 3: Write the component**

Create `packages/web/src/components/agents/AgentRunControls.tsx`:

```tsx
import { isTerminalStatus } from "@journeyman/core";
import { btnSecondary, btnDangerOutline } from "../../routes/admin-styles.ts";

export interface AgentRunControlsProps {
  status: string;
  busy: boolean;
  canWrite: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRerun: () => void;
}

export function AgentRunControls(p: AgentRunControlsProps) {
  if (!p.canWrite) return null;

  const terminal = isTerminalStatus(p.status);
  const running = p.status === "running";
  const paused = p.status === "paused";

  return (
    <div className="flex items-center gap-2">
      {running && (
        <button className={btnSecondary} disabled={p.busy} onClick={p.onPause}>
          ⏸ Pause
        </button>
      )}
      {paused && (
        <button className={btnSecondary} disabled={p.busy} onClick={p.onResume}>
          ▶ Resume
        </button>
      )}
      {!terminal && (
        <button className={btnDangerOutline} disabled={p.busy} onClick={p.onCancel}>
          ⏹ Cancel
        </button>
      )}
      {terminal && (
        <button className={btnSecondary} disabled={p.busy} onClick={p.onRerun}>
          ↻ Re-run
        </button>
      )}
    </div>
  );
}
```

Notes:
- `isTerminalStatus` (`@journeyman/core`) is already used by `AgentRunDetailPage`; `completed`/`failed`/`cancelled` are terminal, `running`/`paused` are not.
- `btnSecondary` and `btnDangerOutline` already exist in `packages/web/src/routes/admin-styles.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @journeyman/web -- AgentRunControls`
Expected: PASS — all 7 assertions green.

(No commit — per execution constraints.)

---

## Task 2: Wire controls into `AgentRunDetailPage`

**Files:**
- Modify: `packages/web/src/routes/AgentRunDetailPage.tsx`

This task has no unit test (it involves SSE + page state + navigation); it is verified by typecheck (Task 3) and manual preview. Make the four edits below exactly.

- [ ] **Step 1: Update imports**

In `packages/web/src/routes/AgentRunDetailPage.tsx`, change the React import (line 1) to add `useCallback`:

```tsx
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
```

Change the `api/runs.ts` import (line 4) to add the action functions:

```tsx
import { cancelRun, getRun, openWorkflowInstanceEventStream, pauseRun, resumeRun, rerunRun } from "../api/runs.ts";
```

Add two new imports after the existing `RunSectionNav` import (after line 11):

```tsx
import { AgentRunControls } from "../components/agents/AgentRunControls.tsx";
import { useWorkspace } from "../WorkspaceContext.tsx";
```

(All four functions — `cancelRun`, `pauseRun`, `resumeRun`, `rerunRun` — are already exported from `packages/web/src/api/runs.ts`. `useWorkspace`/`can` is the same gating used by `RunDetailPage.tsx:27`.)

- [ ] **Step 2: Add state + a reusable `load()` and refactor the fetch effect**

Inside `AgentRunDetailPage`, just after the existing `const [section, setSection] = useState<RunSectionId>("details");` line, add:

```tsx
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { can } = useWorkspace();

  const load = useCallback(async () => {
    if (!runId) return;
    const d = await getRun(wsId, runId);
    setDetail(d);
    const agentId = d.workflowInstance.inputs["agentId"] as string | undefined;
    if (agentId) {
      agentsApi.get(wsId, agentId).then(setAgent).catch(() => null);
    }
  }, [wsId, runId]);
```

Replace the existing first `useEffect` (the one that calls `getRun(wsId, runId).then(...).catch(...).finally(...)`, lines 158–171) with:

```tsx
  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    load()
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [runId, load]);
```

- [ ] **Step 3: Add the action runner**

Immediately after the `allEvents` `useMemo` block (ends around line 187, before the `if (!runId)` guard), add:

```tsx
  async function runAction(fn: () => Promise<unknown>, opts?: { rerun?: boolean }) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      if (opts?.rerun) {
        const newId = (res as { workflowInstanceId: string }).workflowInstanceId;
        navigate(`/workspaces/${wsId}/agent-runs/${newId}`);
        return;
      }
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
```

(`navigate` is already imported and assigned at the top of the component. On re-run, navigating changes the `runId` route param, which re-triggers the fetch effect for the new run.)

- [ ] **Step 4: Render the controls + error line in the header**

In the header JSX, replace the existing "Open workflow instance" anchor block:

```tsx
          <a
            href={`/workspaces/${wsId}/workflow-instances/${wi.id}`}
            className={`${btnSecondary} no-underline`}
          >
            Open workflow instance →
          </a>
```

with:

```tsx
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <AgentRunControls
                status={wi.status}
                busy={busy}
                canWrite={can("resource.write")}
                onPause={() => runAction(() => pauseRun(wsId, wi.id))}
                onResume={() => runAction(() => resumeRun(wsId, wi.id))}
                onCancel={() => runAction(() => cancelRun(wsId, wi.id))}
                onRerun={() => runAction(() => rerunRun(wsId, wi.id), { rerun: true })}
              />
              <a
                href={`/workspaces/${wsId}/workflow-instances/${wi.id}`}
                className={`${btnSecondary} no-underline`}
              >
                Open workflow instance →
              </a>
            </div>
            {actionError && (
              <span className="text-xs text-destructive">{actionError}</span>
            )}
          </div>
```

(`wi` is defined earlier in the function — `const wi = detail.workflowInstance;` — and is in scope here. `cancelRun(wsId, wi.id)` omits the optional `reason` argument, matching the workflow-instance view's default Cancel.)

---

## Task 3: Final verification (typecheck)

**Files:** none (verification only)

- [ ] **Step 1: Confirm the new unit test still passes**

Run: `npm test -w @journeyman/web -- AgentRunControls`
Expected: PASS (7 assertions).

- [ ] **Step 2: Typecheck the whole repo**

Run: `npm run typecheck`
Expected: exits 0 with no TypeScript errors.

If errors appear, fix them in the files above and re-run. Do not commit.

- [ ] **Step 3: (Optional) manual preview check**

Per the spec's verification section, optionally verify in the browser preview: a running agent run shows Pause + Cancel; pausing flips the pill to `paused` and shows Resume; a terminal run shows Re-run (lands on the new agent-run view); a viewer-role user sees no controls.

---

## Self-Review

**Spec coverage:**
- Cancel/Stop, Pause, Resume, Re-run → Task 1 (rendering/gating) + Task 2 (wiring). ✅
- Reuse existing workflow-instance endpoints, no backend → Task 2 uses `api/runs.ts` functions that hit `/workflow-instances/:id/*`; no backend tasks. ✅
- Status gating (running/paused/terminal) → Task 1 component + test. ✅
- Viewer permission gating (`!can("resource.write")`) → Task 1 (`canWrite` prop) + Task 2 (`can("resource.write")`). ✅
- Busy disabling + refetch on success → Task 2 `runAction` + `load`. ✅
- Re-run navigates to agent-run context → Task 2 `runAction({ rerun: true })`. ✅
- Inline error on failure (incl. 501 from unsupported engine) → Task 2 `actionError` line. ✅
- Not sharing `RunTopbar`; agent-specific component → new `AgentRunControls`. ✅

**Placeholder scan:** none — all steps contain full code/commands.

**Type consistency:** `AgentRunControlsProps` fields (`status`, `busy`, `canWrite`, `onPause`, `onResume`, `onCancel`, `onRerun`) match the props passed in Task 2. `rerunRun` returns `{ workflowInstanceId, engineWorkflowId }`; `runAction` reads `.workflowInstanceId`. `cancelRun(wsId, runId, reason?)`, `pauseRun(wsId, runId)`, `resumeRun(wsId, runId)` signatures match the calls. ✅
