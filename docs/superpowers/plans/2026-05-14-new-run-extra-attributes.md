# New Run Dialog — Extra Attributes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the New Run dialog read dynamic inputs from `start.config.workflowInputs` (the canonical source authored via the flow editor) instead of the always-empty `WorkflowGraph.inputDefs`, so workflow-declared extra attributes appear as fields when the user opens the dialog.

**Architecture:** Local change in one React file. The whole system already produces and consumes `start.config.workflowInputs` through the shared helper `getStartWorkflowInputs(start.config)` from `@journeyman/core`. Only the New Run dialog reads from a different location; we point it at the helper so it joins the rest of the system. No type, API, schema, or backend changes.

**Tech Stack:** React (Vite), TypeScript, `@tanstack/react-query`, `@journeyman/core` types and utilities.

**Spec:** [docs/superpowers/specs/2026-05-14-new-run-extra-attributes-design.md](docs/superpowers/specs/2026-05-14-new-run-extra-attributes-design.md)

**Note on testing:** `packages/web` has no automated test suite. Verification is done via the dev server using the preview tools — start the server, open the dialog with a couple of representative workflows, and confirm fields render and submit as expected.

---

## Task 1: Repoint the New Run dialog at `start.config.workflowInputs`

**Files:**
- Modify: `packages/web/src/routes/RunsListPage.tsx` (imports near top of file; `inputDefs` derivation at line 45)

- [ ] **Step 1: Add `getStartWorkflowInputs` to the existing `@journeyman/core` import**

Open `packages/web/src/routes/RunsListPage.tsx`. The current value import from `@journeyman/core` is at line 6:

```tsx
import { buildIssueRef } from "@journeyman/core";
```

Change it to include `getStartWorkflowInputs`:

```tsx
import { buildIssueRef, getStartWorkflowInputs } from "@journeyman/core";
```

Leave the type-only import on line 5 (`import type { Workflow, WorkflowInstance, WorkflowInputDef, ... }`) unchanged — `WorkflowInputDef` is still used as the annotation on `inputDefs`.

- [ ] **Step 2: Replace the `inputDefs` derivation**

Find this line (currently line 45 inside `NewRunDialog`):

```tsx
  const inputDefs: WorkflowInputDef[] = versionQ.data?.definition.inputDefs ?? [];
```

Replace it with:

```tsx
  const startNode = versionQ.data?.definition.nodes.find(n => n.type === "start");
  const inputDefs: WorkflowInputDef[] = getStartWorkflowInputs(startNode?.config);
```

Rationale:
- `versionQ.data` is `WorkflowVersion | undefined`; `versionQ.data?.definition.nodes` is `WorkflowNode[] | undefined`, so the optional chain on `.find(...)` correctly yields `WorkflowNode | undefined`.
- `getStartWorkflowInputs` accepts `WorkflowNode["config"] | undefined` and returns `WorkflowInputDef[]` (`[]` when no inputs declared), preserving the existing empty-array fallback.
- This is the same helper used by `use-upstream-sources.ts`, `validate-ref-shape.ts`, `conductor-converter.ts`, and `FlowSettingsView.tsx`.

Do not touch anything else in the file. The dynamic field rendering loop (`{inputDefs.map(def => ...)}` around line 164), the typed coercion (`if (def.type === "number") ...` around lines 53–60), the `missingRequired` gate (line 78), and the submit payload all consume `inputDefs` and remain unchanged.

- [ ] **Step 3: Type-check the web package**

Run from the repo root:

```bash
npm run typecheck --workspace=@journeyman/web
```

Expected: no TypeScript errors. If `npm run typecheck` is only wired at the root, run `npx tsc --noEmit -p packages/web` instead — `packages/web/package.json` defines `"typecheck": "tsc --noEmit"`.

If you see errors about `n.type === "start"`, double-check `WorkflowNode.type` is the union that includes `"start"` (it is, per `packages/core/src/types/flow.types.ts`).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/routes/RunsListPage.tsx
git commit -m "fix(web): new-run dialog reads workflow inputs from start node

The dialog was reading from definition.inputDefs, a field declared in
flow.types but never populated. Switch to start.config.workflowInputs
via getStartWorkflowInputs — the same source every other consumer
already uses (orchestrator converter, ref-shape validators, flow editor
properties panel)."
```

---

## Task 2: Verify in the browser

**Files:** none (verification only)

This task uses the preview tools. The change is a UI behaviour fix with no automated tests in this package, so empirical verification is mandatory before declaring done.

- [ ] **Step 1: Start the dev server**

Use `preview_start` on `packages/web` (Vite). If a preview is already running, use `preview_list` first and reuse it; otherwise start a new one.

If the app needs a backend (`@journeyman/api-server`) to list workflows, ensure it is already running in the user's environment — this plan does not start it. If listing workflows fails because the API is down, stop and flag it to the user rather than mocking.

- [ ] **Step 2: Open the Workflow Instances page and the New Run dialog**

Navigate to `/workflow-instances`. Click the button that opens **New Run** (rendered by `RunsListPage.tsx`).

Use `preview_snapshot` to capture the open dialog.

- [ ] **Step 3: Case A — workflow with NO declared inputs**

Pick a workflow whose start node has no `workflowInputs` (e.g. the `github issue creator` shown in the bug report screenshot, unless it has been updated since).

Expected snapshot contents:
- Workflow selector with the chosen flow selected
- Personal/Org/Global scope badge
- Issue Ref provider+id row
- No additional input fields below Issue Ref
- Run and Cancel buttons

Capture a screenshot with `preview_screenshot`.

- [ ] **Step 4: Case B — workflow WITH declared inputs**

If no existing workflow declares `workflowInputs`, open the flow editor for a test workflow you own, open the start node's Flow Settings panel ([FlowSettingsView.tsx](packages/flow-editor/src/properties-panel/FlowSettingsView.tsx)), and add two inputs:

- `repoSlug` — type `string`, required
- `dryRun`   — type `boolean`, not required, description `Skip side effects`

Save and (if required) publish the workflow so it appears as `ready` in the New Run flow dropdown. Then re-open New Run, select that workflow, and capture a `preview_snapshot`.

Expected snapshot contents:
- Workflow + Issue Ref rows as in Case A
- A required text input labelled `repoSlug` with a red asterisk
- A boolean select labelled `dryRun` with options `— select —`, `true`, `false`, and the description text `Skip side effects`
- The **Run** button is disabled while `repoSlug` is empty
- The **Run** button becomes enabled once `repoSlug` has a non-empty value (the boolean is optional)

Capture a screenshot with `preview_screenshot`.

- [ ] **Step 5: Case B submit smoke test (optional but recommended)**

Fill `repoSlug` with `acme/widgets` and pick `true` for `dryRun`. Use `preview_network` to record the outgoing request, then click Run.

Expected network entry:
- `POST /workflows/<id>/workflow-instances`
- Request body JSON includes `inputs.repoSlug === "acme/widgets"` and `inputs.dryRun === true`
- If an Issue Ref was provided, it is also present as `inputs.issueRef`
- Response is `202` with `{ workflowInstanceId, engineWorkflowId }`

Note: actually starting a run has side effects (creates a workflow instance row, may trigger downstream phases). Only run Step 5 if the user has confirmed it is safe in this environment, or against a throwaway test workflow you authored in Step 4.

- [ ] **Step 6: Report verification results to the user**

Share the two screenshots (Case A, Case B) and, if Step 5 was performed, the captured `POST` body, so the user can confirm acceptance criteria 1–4 from the spec are met.

There is nothing to commit in this task.

---

## Self-Review

**Spec coverage:**
- AC 1 (renders one field per `workflowInputs` entry with correct widget): Task 1 step 2 + Task 2 Step 4.
- AC 2 (Run disabled until required inputs filled): existing `missingRequired` logic at `RunsListPage.tsx:78` untouched; verified in Task 2 Step 4.
- AC 3 (submission payload includes dynamic values with type coercion): existing submit-mutation block at `RunsListPage.tsx:47-63` untouched; verified in Task 2 Step 5.
- AC 4 (no `workflowInputs` ⇒ dialog unchanged): verified in Task 2 Step 3.
- AC 5 (no changes outside `RunsListPage.tsx`): enforced by Task 1's single-file modify scope.
- Non-goal "leave Issue Ref alone": Task 1 explicitly does not touch the Issue Ref block.

**Placeholder scan:** No TBDs, no "add validation as appropriate", no "similar to task N". Every code change is shown in full.

**Type consistency:** `getStartWorkflowInputs` is imported once and called with `WorkflowNode["config"] | undefined`, which matches its signature in `packages/core/src/utils/start-node.ts`. `WorkflowInputDef` is the same type already used by the existing render loop — no signature drift.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-14-new-run-extra-attributes.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
