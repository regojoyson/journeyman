# Workflow Permissions Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move workflow delete from the list into the editor view (draft-only), add a central capabilities resolver so roles gate all toolbar actions consistently, hide the steps palette for read-only/observer users, and guard the backend DELETE endpoint against deleting non-draft flows.

**Architecture:** A pure `workflowCapabilities()` helper in `packages/web/src/lib/` becomes the single source of truth for all gating flags. `FlowEditorPage` resolves it once and distributes props to `FlowEditor` and `Topbar`. The Palette and delete button are wired to these flags with no scattered `can()` calls in the rendering tree.

**Tech Stack:** React (TypeScript), Vitest (unit tests), Fastify (API server). No DB migrations. No commits — typecheck at the end only.

---

## File Map

| File | Action |
|---|---|
| `packages/web/src/lib/workflow-capabilities.ts` | **Create** — pure helper + types |
| `packages/web/src/lib/workflow-capabilities.test.ts` | **Create** — 6-case role × status matrix test |
| `packages/api-server/src/routes/flows.ts` | **Modify** — add draft-status guard to DELETE handler |
| `packages/web/src/api/flows.ts` | **Modify** — add `deleteFlow(wsId, id)` with correct workspace-scoped URL |
| `packages/web/src/api/flow-grants.ts` | **Modify** — remove broken `deleteFlow` (was using wrong URL) |
| `packages/flow-editor/src/topbar/Topbar.tsx` | **Modify** — add `onDelete?: () => void` + `exportEnabled?: boolean` prop; gate View JSON + Delete buttons |
| `packages/flow-editor/src/types.ts` | **Modify** — add `showPalette?: boolean`, `onDelete?: () => void`, `exportEnabled?: boolean` to `FlowEditorProps` |
| `packages/flow-editor/src/palette/Palette.tsx` | **Modify** — add `visible?: boolean` prop, return null when false |
| `packages/flow-editor/src/FlowEditor.tsx` | **Modify** — wire `showPalette` from props to Palette; pass `onDelete` to Topbar |
| `packages/web/src/routes/FlowEditorPage.tsx` | **Modify** — resolve capabilities, pass all flags to FlowEditor |
| `packages/web/src/routes/FlowsListPage.tsx` | **Modify** — remove `handleDelete`, `canDelete`, delete button, and `deleteFlow` import |

---

## Task 1: `workflowCapabilities` helper + unit tests

**Files:**
- Create: `packages/web/src/lib/workflow-capabilities.ts`
- Create: `packages/web/src/lib/workflow-capabilities.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/workflow-capabilities.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { workflowCapabilities } from "./workflow-capabilities.ts";
import type { WorkspacePermission } from "@journeyman/core";

const make = (perms: WorkspacePermission[]) =>
  (p: WorkspacePermission) => perms.includes(p);

const observer   = make(["workspace.view", "resource.read"]);
const contributor = make(["workspace.view", "resource.read", "resource.write", "resource.delete"]);
const maintainer  = make(["workspace.view", "resource.read", "resource.write", "resource.delete", "members.manage", "settings.manage"]);

describe("workflowCapabilities", () => {
  it("observer + draft: readOnly only", () => {
    expect(workflowCapabilities({ can: observer, status: "draft" })).toEqual({
      readOnly: true, canEdit: false, showPalette: false,
      canImport: false, canExport: false, canPublish: false, canDelete: false,
    });
  });

  it("observer + ready: readOnly only", () => {
    expect(workflowCapabilities({ can: observer, status: "ready" })).toEqual({
      readOnly: true, canEdit: false, showPalette: false,
      canImport: false, canExport: false, canPublish: false, canDelete: false,
    });
  });

  it("contributor + draft: full edit + delete", () => {
    expect(workflowCapabilities({ can: contributor, status: "draft" })).toEqual({
      readOnly: false, canEdit: true, showPalette: true,
      canImport: true, canExport: true, canPublish: true, canDelete: true,
    });
  });

  it("contributor + ready: readOnly, can export + publish, no delete", () => {
    expect(workflowCapabilities({ can: contributor, status: "ready" })).toEqual({
      readOnly: true, canEdit: false, showPalette: false,
      canImport: false, canExport: true, canPublish: true, canDelete: false,
    });
  });

  it("maintainer + draft: full edit + delete", () => {
    expect(workflowCapabilities({ can: maintainer, status: "draft" })).toEqual({
      readOnly: false, canEdit: true, showPalette: true,
      canImport: true, canExport: true, canPublish: true, canDelete: true,
    });
  });

  it("maintainer + ready: readOnly, can export + publish, no delete", () => {
    expect(workflowCapabilities({ can: maintainer, status: "ready" })).toEqual({
      readOnly: true, canEdit: false, showPalette: false,
      canImport: false, canExport: true, canPublish: true, canDelete: false,
    });
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd packages/web && npx vitest run src/lib/workflow-capabilities.test.ts
```
Expected: FAIL — `workflow-capabilities.ts` not found.

- [ ] **Step 3: Implement the helper**

Create `packages/web/src/lib/workflow-capabilities.ts`:

```typescript
import type { WorkspacePermission, WorkflowStatus } from "@journeyman/core";

export interface WorkflowCapabilities {
  readOnly: boolean;
  canEdit: boolean;
  showPalette: boolean;
  canImport: boolean;
  canExport: boolean;
  canPublish: boolean;
  canDelete: boolean;
}

export function workflowCapabilities({
  can,
  status,
}: {
  can: (perm: WorkspacePermission) => boolean;
  status: WorkflowStatus;
}): WorkflowCapabilities {
  const canWrite = can("resource.write");
  const isDraft = status === "draft";

  const readOnly = !canWrite || !isDraft;
  const canEdit = canWrite && isDraft;

  return {
    readOnly,
    canEdit,
    showPalette: canEdit,
    canImport: canEdit,
    canExport: canWrite,
    canPublish: canWrite,
    canDelete: can("resource.delete") && isDraft,
  };
}
```

- [ ] **Step 4: Run to confirm it passes**

```bash
cd packages/web && npx vitest run src/lib/workflow-capabilities.test.ts
```
Expected: 6 tests pass.

---

## Task 2: Backend draft guard on DELETE

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts` (line 462–468)

- [ ] **Step 1: Add the draft guard before the delete call**

In `packages/api-server/src/routes/flows.ts`, find the DELETE handler (currently at line 462):

```typescript
  app.delete("/workspaces/:wsId/workflows/:id", del, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    await c.workflows.delete(id);
    reply.code(204).send();
  });
```

Replace with:

```typescript
  app.delete("/workspaces/:wsId/workflows/:id", del, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    if (workflow.status !== "draft") { reply.code(409); return { error: "not_draft" }; }
    await c.workflows.delete(id);
    reply.code(204).send();
  });
```

---

## Task 3: `deleteFlow(wsId, id)` in `flows.ts`

**Files:**
- Modify: `packages/web/src/api/flows.ts`
- Modify: `packages/web/src/api/flow-grants.ts`

The existing `deleteFlow` in `flow-grants.ts` calls `/api/workflows/:id` — the server route is `/workspaces/:wsId/workflows/:id` so it was using the wrong URL. Add the correct one to `flows.ts` and remove the broken one from `flow-grants.ts`.

- [ ] **Step 1: Add `deleteFlow` to `packages/web/src/api/flows.ts`**

Append after the last export in `packages/web/src/api/flows.ts`:

```typescript
export async function deleteFlow(wsId: string, id: string): Promise<void> {
  await api(`${wsBase(wsId)}/${encodeURIComponent(id)}`, { method: "DELETE" });
}
```

- [ ] **Step 2: Remove broken `deleteFlow` from `packages/web/src/api/flow-grants.ts`**

`packages/web/src/api/flow-grants.ts` currently only contains `deleteFlow`. After step 1 that function is replaced. Delete the entire file:

```bash
rm packages/web/src/api/flow-grants.ts
```

---

## Task 4: `onDelete` prop in Topbar

**Files:**
- Modify: `packages/flow-editor/src/topbar/Topbar.tsx`

- [ ] **Step 1: Add `onDelete` to `TopbarProps` and render the button**

In `packages/flow-editor/src/topbar/Topbar.tsx`, add `onDelete?: () => void` to the `TopbarProps` interface (after `onFocusNode`):

```typescript
  /** When provided, a danger Delete button appears. Only shown for draft workflows by the caller. */
  onDelete?: () => void;
```

Then add the delete button inside the topbar `<header>` element, immediately after the `{p.dirty && ...}` unsaved indicator and before `{p.status && <StatusPill ...>}`. Place it at the END of the header, after the run button (so it appears as the rightmost action):

In the header, after:
```typescript
        {p.onRun && (
          <IconButton
            className="primary"
            label="Run"
            hint={p.runDisabledReason ?? "Execute this flow"}
            disabled={p.busy || !p.runEnabled}
            onClick={p.onRun}
            icon={<Play size={16} fill="currentColor" aria-hidden="true" focusable="false" />}
          />
        )}
```

Add:
```typescript
        {p.onDelete && (
          <IconButton
            className="je-icon-btn--delete"
            label="Delete"
            hint="Delete this workflow (draft only)"
            icon={<Trash2 size={16} aria-hidden="true" focusable="false" />}
            onClick={() => {
              if (window.confirm("Delete this workflow? This cannot be undone.")) {
                p.onDelete!();
              }
            }}
          />
        )}
```

- [ ] **Step 2: Add `exportEnabled` to `TopbarProps` and gate the View JSON button**

Add `exportEnabled?: boolean` to `TopbarProps` (after `onFocusNode`):

```typescript
  /** When false the View JSON / export panel button is hidden. Defaults to true. */
  exportEnabled?: boolean;
```

Find the View JSON icon button in the topbar header:

```typescript
        {p.flow && (
          <IconButton
            className="je-icon-btn--view-json"
            label="View JSON"
            hint="View the flow as JSON / YAML"
            icon={<FileCode2 size={16} aria-hidden="true" focusable="false" />}
            onClick={() => setExportOpen(true)}
          />
        )}
```

Replace with:

```typescript
        {p.flow && p.exportEnabled !== false && (
          <IconButton
            className="je-icon-btn--view-json"
            label="View JSON"
            hint="View the flow as JSON / YAML"
            icon={<FileCode2 size={16} aria-hidden="true" focusable="false" />}
            onClick={() => setExportOpen(true)}
          />
        )}
```

- [ ] **Step 3: Import `Trash2` from lucide-react**

In the lucide-react import line at the top of `Topbar.tsx`, add `Trash2` to the destructured imports:

```typescript
import {
  Check,
  Copy,
  Download,
  FileCode2,
  Loader2,
  Play,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
```

---

## Task 5: `visible` prop on Palette

**Files:**
- Modify: `packages/flow-editor/src/palette/Palette.tsx`

- [ ] **Step 1: Add `visible` to `PaletteProps` and short-circuit when false**

In `packages/flow-editor/src/palette/Palette.tsx`, update the `PaletteProps` interface:

```typescript
export interface PaletteProps {
  steps: StepDefinition<any>[];
  controlCatalog?: ControlNodeCatalog;
  /** When false the palette is not rendered at all. Defaults to true. */
  visible?: boolean;
}
```

At the top of the `Palette` function body, before any hook calls, add a guard:

```typescript
export function Palette({ steps, controlCatalog, visible = true }: PaletteProps) {
  if (!visible) return null;
  // ... rest of the function unchanged
```

---

## Task 6: `showPalette` + `onDelete` in `FlowEditorProps` and `FlowEditor`

**Files:**
- Modify: `packages/flow-editor/src/types.ts`
- Modify: `packages/flow-editor/src/FlowEditor.tsx`

- [ ] **Step 1: Add props to `FlowEditorProps` in `packages/flow-editor/src/types.ts`**

In `packages/flow-editor/src/types.ts`, add three props to `FlowEditorProps` (after `onUnpublish`):

```typescript
  /** When false the steps palette is hidden. Pass capabilities.showPalette from the host. Defaults to true. */
  showPalette?: boolean;
  /** When provided, a Delete button appears in the topbar. Only pass when the caller's capabilities.canDelete is true. */
  onDelete?: () => void;
  /** When false the View JSON export button is hidden. Pass capabilities.canExport from the host. Defaults to true. */
  exportEnabled?: boolean;
```

- [ ] **Step 2: Wire `showPalette` to Palette and `onDelete` to Topbar in `FlowEditor.tsx`**

In `packages/flow-editor/src/FlowEditor.tsx`, locate the Topbar usage (inside the `return` JSX) and add the `onDelete` prop:

```typescript
        <Topbar
          flowName={props.flowName}
          onRename={effectiveReadOnly ? undefined : props.onRename}
          onSave={props.onSave ? () => props.onSave!(heal.healed) : undefined}
          onRun={props.onRun ? () => props.onRun!(heal.healed) : undefined}
          onValidate={props.onValidate ? () => props.onValidate!(heal.healed) : undefined}
          flow={heal.healed}
          busy={props.busy}
          saveEnabled={!effectiveReadOnly && !!props.onSave}
          runEnabled={!effectiveReadOnly && !!props.onRun && validity.ok && props.status !== "draft"}
          runDisabledReason={
            props.status === "draft"
              ? "Publish this flow to run it."
              : validity.ok ? undefined : validity.errors[0]
          }
          validationErrors={validity.errors}
          onWorkflowSetup={() => setSetupOpen(true)}
          onImport={effectiveReadOnly ? undefined : (flow) => props.onChange(flow)}
          status={props.status}
          onPublishClick={props.onPublish ? handlePublishClick : undefined}
          onUnpublishClick={props.onUnpublish ? handleUnpublishClick : undefined}
          onFocusNode={focusNode}
          onDelete={props.onDelete}
          exportEnabled={props.exportEnabled}
        />
```

Then locate the `<Palette>` render (inside the grid body) and add the `visible` prop:

```typescript
              <Palette
                steps={props.steps}
                controlCatalog={props.controlCatalog}
                visible={props.showPalette !== false}
              />
```

Also, hide the palette's PanelResizer and remove its grid column when the palette is not visible. Find the grid columns calculation block:

```typescript
          const gridCols = rightPanelOpen
            ? `${paletteWidth}px 6px 1fr 6px ${propsWidth}px`
            : `${paletteWidth}px 6px 1fr`;
```

Replace with:

```typescript
          const showPalette = props.showPalette !== false;
          const gridCols = rightPanelOpen
            ? (showPalette ? `${paletteWidth}px 6px 1fr 6px ${propsWidth}px` : `1fr 6px ${propsWidth}px`)
            : (showPalette ? `${paletteWidth}px 6px 1fr` : `1fr`);
```

And wrap the `<PanelResizer side="left">` in a conditional so it only renders when the palette is shown:

```typescript
              {showPalette && (
                <PanelResizer width={paletteWidth} onResize={setPaletteWidth} side="left" min={160} max={480} />
              )}
```

---

## Task 7: FlowEditorPage wires capabilities

**Files:**
- Modify: `packages/web/src/routes/FlowEditorPage.tsx`

This task replaces the scattered `editable` checks with `workflowCapabilities`, wires delete, and passes `showPalette`.

- [ ] **Step 1: Add imports**

At the top of `packages/web/src/routes/FlowEditorPage.tsx`, add:

```typescript
import { workflowCapabilities } from "../lib/workflow-capabilities.ts";
import { deleteFlow } from "../api/flows.ts";
```

- [ ] **Step 2: Resolve capabilities from `can` + `flow.status`**

The page currently has:
```typescript
  const { can } = useWorkspace();
  const editable = can("resource.write");
```

Replace with:
```typescript
  const { can } = useWorkspace();
```

Then, AFTER `const flow = flowQ.data;` (around line 117), derive capabilities:

```typescript
  const caps = workflowCapabilities({ can, status: flow.status });
```

- [ ] **Step 3: Add delete handler**

After `const onUnpublish = ...` handler, add:

```typescript
  const onDelete = async () => {
    try {
      await deleteFlow(wsId, flow.id);
      qc.invalidateQueries({ queryKey: ["flows"] });
      navigate(`/workspaces/${wsId}/workflows`);
    } catch (e) {
      setSaveToast({ kind: "error", message: `Delete failed: ${(e as Error).message}` });
    }
  };
```

- [ ] **Step 4: Update the read-only banner condition**

Find:
```typescript
        {!editable && (
          <div style={{
            padding: "8px 12px", marginBottom: 12,
            background: "rgb(var(--color-warning) / 0.18)", border: "1px solid rgb(var(--color-warning) / 1)", borderRadius: 4,
          }}>
            This flow is read-only. You do not have edit access to this workspace.
          </div>
        )}
```

Replace with:
```typescript
        {caps.readOnly && flow.status === "draft" && (
          <div style={{
            padding: "8px 12px", marginBottom: 12,
            background: "rgb(var(--color-warning) / 0.18)", border: "1px solid rgb(var(--color-warning) / 1)", borderRadius: 4,
          }}>
            This flow is read-only. You do not have edit access to this workspace.
          </div>
        )}
```

- [ ] **Step 5: Update `<FlowEditor>` props**

Replace the entire `<FlowEditor ...>` element with:

```typescript
          <FlowEditor
            flow={graph}
            flowName={flow.name}
            readOnly={caps.readOnly}
            onRename={caps.canEdit ? (next) => {
              const trimmed = next.trim();
              if (!trimmed || trimmed === flow.name) return;
              renameM.mutate(trimmed);
            } : undefined}
            orgId={activeOrgId}
            wsId={wsId}
            steps={[...builtInSteps, ...customStepDefs]}
            controlCatalog={defaultControlCatalog}
            mcpCatalog={defaultMcpCatalog}
            onChange={(next) => { setGraph(next); setDirty(true); }}
            onSave={caps.canEdit ? async (next) => { await saveM.mutateAsync(next); } : undefined}
            onValidate={async (next) => await validateFlowDefinition(wsId, next)}
            busy={saveM.isPending}
            status={flow.status}
            onPublish={caps.canPublish ? onPublish : undefined}
            onUnpublish={caps.canPublish ? onUnpublish : undefined}
            showPalette={caps.showPalette}
            onDelete={caps.canDelete ? onDelete : undefined}
            exportEnabled={caps.canExport}
          />
```

---

## Task 8: Remove delete from FlowsListPage

**Files:**
- Modify: `packages/web/src/routes/FlowsListPage.tsx`

- [ ] **Step 1: Remove `deleteFlow` import and `canDelete` variable**

Remove this import line:
```typescript
import { deleteFlow } from "../api/flow-grants.ts";
```

Remove this line from the component body:
```typescript
  const canDelete = can("resource.delete");
```

- [ ] **Step 2: Remove `handleDelete` function**

Remove the entire function:
```typescript
  async function handleDelete(flow: Workflow) {
    if (!window.confirm(`Delete flow "${flow.name}"? This cannot be undone.`)) return;
    try {
      await deleteFlow(flow.id);
      await fetchFlows(page, pageSize);
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    }
  }
```

- [ ] **Step 3: Remove the delete button from the table row actions**

Remove these lines from the editable actions block:
```typescript
                            {canDelete && (
                              <button
                                onClick={() => handleDelete(f)}
                                className="text-danger hover:text-danger"
                              >Delete</button>
                            )}
```

---

## Task 9: Typecheck

- [ ] **Step 1: Run typecheck across the whole monorepo**

```bash
npm run typecheck
```

Expected: exits 0, no type errors. If there are errors, fix them before marking complete.

- [ ] **Step 2: Run the unit tests**

```bash
cd packages/web && npx vitest run
```

Expected: all tests pass including the 6 new `workflow-capabilities` tests.
