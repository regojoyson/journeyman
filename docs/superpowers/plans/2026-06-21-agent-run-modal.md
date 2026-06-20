# Agent Run Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared `RunAgentModal` that starts an agent run from both the agents list page (enabled agents only) and the agent detail page, then navigates to the run view page.

**Architecture:** One new component `RunAgentModal` owns all run-input rendering and submit logic. The list page gains a `Run` button (gated on `agent.enabled`) and a `runTarget` state that mounts the modal. The detail page drops its inline run form and opens the same modal; on success the modal navigates to `/workspaces/{wsId}/agent-runs/{workflowInstanceId}`. No backend, API-client, or `@journeyman/core` changes — `agentsApi.runNow` and the run-view route already exist.

**Tech Stack:** React + TypeScript, react-router-dom (`useNavigate`), Vitest with `react-dom/server` `renderToStaticMarkup` for static-markup tests (the established web test pattern — there is no jsdom/testing-library in `@journeyman/web`).

**Working agreement for this plan:** Work on the `master` branch. **No git commits** — leave all changes in the working tree. The final verification step is a typecheck.

---

## File Structure

- **Create** `packages/web/src/components/agents/shared/RunAgentModal.tsx` — the modal: renders agent input fields (or a no-inputs confirmation), submits via `agentsApi.runNow`, navigates to the run view page.
- **Create** `packages/web/src/components/agents/shared/RunAgentModal.test.tsx` — static-markup tests for the inputs variant, the no-inputs variant, and the required-field disabled state.
- **Modify** `packages/web/src/components/agents/AgentsList.tsx` — add a `Run` button (enabled agents only) and mount the modal.
- **Modify** `packages/web/src/components/agents/AgentDetail.tsx` — replace the inline run form with the modal; remove now-dead state/imports.

Reference (no changes): `packages/web/src/api/agents.ts` (`runNow` returns `{ workflowInstanceId }`), `packages/web/src/routes/AgentRunDetailPage.tsx` (route `/workspaces/:wsId/agent-runs/:runId`).

---

## Task 1: Create `RunAgentModal`

**Files:**
- Create: `packages/web/src/components/agents/shared/RunAgentModal.tsx`
- Test: `packages/web/src/components/agents/shared/RunAgentModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/agents/shared/RunAgentModal.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Agent, AgentInputField } from "@journeyman/core";
import { RunAgentModal } from "./RunAgentModal.tsx";

const base: Agent = {
  id: "a1", workspaceId: "w1", orgId: "o1", name: "triager",
  instructions: "x", inputs: [], provider: "claude", model: "claude-opus-4-8",
  connectorMcpIds: [], tools: [], skillIds: [], repoSelections: [],
  permissions: { allowedTools: [] }, notifications: { on: [] }, outputMode: "text",
  behavior: {}, triggers: [], status: "active", enabled: true,
  createdBy: "u1", createdAt: "2026-06-19T00:00:00Z", updatedAt: "2026-06-19T00:00:00Z",
};

function render(a: Agent) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <RunAgentModal wsId="w1" agent={a} onClose={() => {}} />
    </MemoryRouter>,
  );
}

const inputs: AgentInputField[] = [
  { name: "issueUrl", type: "text", required: true },
  { name: "notify", type: "boolean", required: false, default: true },
];

describe("RunAgentModal", () => {
  it("renders the title, agent name, and each input field", () => {
    const html = render({ ...base, inputs });
    expect(html).toContain("Run agent");
    expect(html).toContain("triager");
    expect(html).toContain("issueUrl");
    expect(html).toContain("notify");
  });

  it("disables Run while a required field is empty", () => {
    const html = render({ ...base, inputs });
    expect(html).toContain("disabled");
  });

  it("shows a confirmation and an enabled Run button when there are no inputs", () => {
    const html = render({ ...base, inputs: [] });
    expect(html).toContain("takes no inputs");
    expect(html).toContain("triager");
    expect(html).not.toContain("disabled");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @journeyman/web -- RunAgentModal`
Expected: FAIL — `Failed to resolve import "./RunAgentModal.tsx"` (module does not exist yet).

- [ ] **Step 3: Write the component**

Create `packages/web/src/components/agents/shared/RunAgentModal.tsx`:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Agent, AgentInputField } from "@journeyman/core";
import { agentsApi } from "../../../api/agents.ts";
import { btnPrimary, btnGhost, card, inputCls } from "../../../routes/admin-styles.ts";

export interface RunAgentModalProps {
  wsId: string;
  agent: Agent;
  onClose: () => void;
  onStarted?: (workflowInstanceId: string) => void;
}

type FieldValue = string | boolean;

function initialValue(f: AgentInputField): FieldValue {
  if (f.type === "boolean") return typeof f.default === "boolean" ? f.default : false;
  return f.default == null ? "" : String(f.default);
}

export function RunAgentModal({ wsId, agent, onClose, onStarted }: RunAgentModalProps) {
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, FieldValue>>(() =>
    Object.fromEntries(agent.inputs.map((f) => [f.name, initialValue(f)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missingRequired = agent.inputs.some(
    (f) => f.required && f.type !== "boolean" && String(values[f.name] ?? "").trim() === "",
  );

  const setField = (name: string, value: FieldValue) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const inputs: Record<string, unknown> = {};
      for (const f of agent.inputs) {
        const v = values[f.name];
        inputs[f.name] = f.type === "number" ? Number(v) : v;
      }
      const { workflowInstanceId } = await agentsApi.runNow(wsId, agent.id, inputs);
      if (onStarted) onStarted(workflowInstanceId);
      else navigate(`/workspaces/${wsId}/agent-runs/${workflowInstanceId}`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6">
      <div className={`${card} w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Run agent</h2>
            <p className="text-sm text-muted-foreground">{agent.name}</p>
          </div>
          <button className="text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {agent.inputs.length === 0 ? (
          <p className="text-sm">
            Run <span className="font-medium">{agent.name}</span>? This agent takes no inputs.
          </p>
        ) : (
          <div className="space-y-3">
            {agent.inputs.map((f) => (
              <div key={f.name} className="space-y-1">
                <label className="block text-sm font-medium">
                  {f.name}
                  {f.required && <span className="text-destructive"> *</span>}
                </label>
                {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
                {f.type === "boolean" ? (
                  <input
                    type="checkbox"
                    checked={values[f.name] === true}
                    onChange={(e) => setField(f.name, e.target.checked)}
                  />
                ) : (
                  <input
                    className={inputCls}
                    type={f.type === "number" ? "number" : "text"}
                    value={String(values[f.name] ?? "")}
                    onChange={(e) => setField(f.name, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {error && <div className="text-sm text-destructive">{error}</div>}

        <div className="flex justify-end gap-2 border-t pt-4">
          <button className={btnGhost} disabled={busy} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} disabled={busy || missingRequired} onClick={submit}>
            {busy ? "Starting…" : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @journeyman/web -- RunAgentModal`
Expected: PASS — all three tests green.

---

## Task 2: Add the Run button to the agents list page

**Files:**
- Modify: `packages/web/src/components/agents/AgentsList.tsx`

This page fetches its rows in a `useEffect`, which does not run under `renderToStaticMarkup`, so there is no meaningful static-markup test for the button's presence. It is verified by the typecheck in Task 4 (and visually in the running app). Do not fabricate a jsdom test.

- [ ] **Step 1: Import the modal and add `runTarget` state**

In `packages/web/src/components/agents/AgentsList.tsx`, add the import after the existing imports (the `Agent` type is already imported):

```tsx
import { RunAgentModal } from "./shared/RunAgentModal.tsx";
```

Inside `AgentsList`, add state next to the existing `useState` hooks (after `const [error, setError] = useState<string | null>(null);`):

```tsx
  const [runTarget, setRunTarget] = useState<Agent | null>(null);
```

- [ ] **Step 2: Add the Run button to each row's action cell**

Replace the action cell (currently):

```tsx
              <td className="px-4 py-2 text-right">
                <button className={btnGhost} onClick={() => navigate(`/workspaces/${wsId}/agents/${a.id}`)}>Open</button>
              </td>
```

with:

```tsx
              <td className="px-4 py-2 text-right">
                <div className="flex justify-end gap-2">
                  {a.enabled && (
                    <button className={btnGhost} onClick={() => setRunTarget(a)}>▶ Run</button>
                  )}
                  <button className={btnGhost} onClick={() => navigate(`/workspaces/${wsId}/agents/${a.id}`)}>Open</button>
                </div>
              </td>
```

- [ ] **Step 3: Mount the modal**

Immediately before the final closing `</div>` of the component's returned JSX (after the `</table>`), add:

```tsx
      {runTarget && (
        <RunAgentModal wsId={wsId} agent={runTarget} onClose={() => setRunTarget(null)} />
      )}
```

- [ ] **Step 4: Verify the file typechecks in isolation**

Run: `npm test -w @journeyman/web -- RunAgentModal`
Expected: PASS (still green — this task does not change the modal; this confirms nothing regressed). Full typecheck happens in Task 4.

---

## Task 3: Replace the inline run form on the detail page with the modal

**Files:**
- Modify: `packages/web/src/components/agents/AgentDetail.tsx`

- [ ] **Step 1: Confirm the existing detail tests still describe current behavior**

Run: `npm test -w @journeyman/web -- AgentDetail`
Expected: PASS (baseline — these tests assert name/status/lock banner, none of which this task changes).

- [ ] **Step 2: Import the modal**

In `packages/web/src/components/agents/AgentDetail.tsx`, add after the existing section imports (e.g. after the `DeleteSection` import on line 18):

```tsx
import { RunAgentModal } from "./shared/RunAgentModal.tsx";
```

- [ ] **Step 3: Replace the run-form state with a single boolean**

Remove these two lines (currently lines 66–67):

```tsx
  const [showRunForm, setShowRunForm] = useState(false);
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});
```

Add in their place:

```tsx
  const [showRun, setShowRun] = useState(false);
```

- [ ] **Step 4: Remove `openRun` and `runNow`**

Delete the entire `openRun` function (currently lines 139–146) and the entire `runNow` function (currently lines 148–160). They are replaced by the modal.

- [ ] **Step 5: Point the "Run now" button at the modal**

Replace the Run now button (currently line 179):

```tsx
              <button className={btnGhost} disabled={busy || !a.enabled} onClick={openRun}>Run now</button>
```

with:

```tsx
              <button className={btnGhost} disabled={busy || !a.enabled} onClick={() => setShowRun(true)}>Run now</button>
```

- [ ] **Step 6: Replace the inline form JSX with the modal**

Remove the inline run-form block (currently lines 221–239, the `{showRunForm && ( … )}` JSX):

```tsx
        {showRunForm && (
          <div className={`${card} p-4 space-y-3`}>
            <div className="font-medium text-sm">Run now — provide inputs</div>
            {a.inputs.map((inp) => (
              <div key={inp.name} className="flex items-center gap-2">
                <span className="text-sm w-32 truncate" title={inp.name}>{inp.name}</span>
                <input
                  className={inputCls}
                  value={runInputs[inp.name] ?? ""}
                  onChange={(e) => setRunInputs((prev) => ({ ...prev, [inp.name]: e.target.value }))}
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button className={btnPrimary} disabled={busy} onClick={() => runNow(runInputs)}>Run</button>
              <button className={btnGhost} disabled={busy} onClick={() => setShowRunForm(false)}>Cancel</button>
            </div>
          </div>
        )}
```

Replace it with the modal mount:

```tsx
        {showRun && (
          <RunAgentModal wsId={wsId} agent={a} onClose={() => setShowRun(false)} />
        )}
```

The modal navigates to `/workspaces/${wsId}/agent-runs/${workflowInstanceId}` on success (its default behavior), so the old `selectSection("runs")` navigation is intentionally gone.

- [ ] **Step 7: Remove the now-unused `inputCls` import**

`inputCls` was only used by the deleted inline form. Change line 7 from:

```tsx
import { btnPrimary, btnGhost, card, inputCls } from "../../routes/admin-styles.ts";
```

to:

```tsx
import { btnPrimary, btnGhost, card } from "../../routes/admin-styles.ts";
```

(Leave `btnPrimary` and `card` — both are still used by `SectionSaveBar` and the layout. `btnGhost` is still used by the Run now button.)

- [ ] **Step 8: Re-run the detail tests**

Run: `npm test -w @journeyman/web -- AgentDetail`
Expected: PASS — the existing assertions (name, `DRAFT`/`ENABLED`, instructions section, lock banner) are unaffected.

---

## Task 4: Final verification (typecheck + full web tests)

**Files:** none (verification only)

- [ ] **Step 1: Run the full web test suite**

Run: `npm test -w @journeyman/web`
Expected: PASS — all web tests, including the new `RunAgentModal` tests and the existing `AgentDetail` tests, are green.

- [ ] **Step 2: Typecheck the workspace**

Run: `npm run typecheck`
Expected: PASS with no errors. In particular, `AgentDetail.tsx` must report no "declared but never used" errors for `inputCls`, `openRun`, `runNow`, `showRunForm`, or `runInputs` (all removed in Task 3), and `RunAgentModal` must satisfy `RunAgentModalProps`.

- [ ] **Step 3: Leave changes uncommitted**

Per this plan's working agreement, do **not** run `git commit`. Confirm the working tree holds the new and modified files:

Run: `git status --short`
Expected: shows `??` for `packages/web/src/components/agents/shared/RunAgentModal.tsx` and `RunAgentModal.test.tsx`, and `M` for `AgentsList.tsx` and `AgentDetail.tsx`.

---

## Self-Review Notes

- **Spec coverage:** List-page Run button gated on `enabled` (Task 2) ✓; popup with inputs (Task 1) ✓; detail-page inline form → modal (Task 3) ✓; navigate to run view page on create (Task 1, default `navigate` behavior; old `selectSection("runs")` removed in Task 3 Step 6) ✓; no-inputs confirmation variant (Task 1, spec's confirm-modal decision) ✓.
- **Type consistency:** `RunAgentModalProps` defined in Task 1 is consumed identically in Tasks 2 and 3 (`wsId`, `agent`, `onClose`). `agentsApi.runNow` returns `{ workflowInstanceId }`, matching the destructure in Task 1.
- **No placeholders:** every code step shows complete code; every command lists expected output.
- **Test realism:** `@journeyman/web` has no jsdom, so tests use `renderToStaticMarkup` (matching `AgentDetail.test.tsx`). Interaction-only behaviors (click→navigate, submit→`runNow`) are covered by typecheck plus the static disabled/enabled assertions, not by fabricated DOM-event tests.
