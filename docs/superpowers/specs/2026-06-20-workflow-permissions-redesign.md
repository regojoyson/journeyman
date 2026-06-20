# Workflow Permissions Redesign

**Date:** 2026-06-20
**Status:** Approved

## Overview

Three coordinated changes to how workflow permissions work in the editor view:

1. **Delete moves from the list into the editor view**, gated to draft-only.
2. **Strict role-based toolbar rules** with a centralised capabilities resolver.
3. **Steps palette hidden** unless the user can edit (draft + write permission).

---

## Background & Current State

- `WorkspaceRole`: `maintainer | contributor | observer`
- `WorkspacePermission`: `resource.read`, `resource.write`, `resource.delete`
- Observer → read only. Contributor → read + write + delete. Maintainer → all.
- `WorkflowStatus`: `"draft" | "ready"` (`packages/core/src/types/flow.types.ts`)
- `effectiveReadOnly` in `FlowEditor` = `!can("resource.write") || status === "ready"`
- Delete button currently lives on `FlowsListPage` gated by `resource.delete`, with no status check.
- Steps palette (`Palette.tsx`) always renders; only drag is disabled when read-only.
- Import/export gated by `effectiveReadOnly`, not by role explicitly.

---

## Design

### 1. Capabilities Resolver

A single pure helper `workflowCapabilities({ can, status })` in `packages/web/src/lib/workflow-capabilities.ts` returns a flat bag of booleans:

| Capability | Rule |
|---|---|
| `readOnly` | `!can("resource.write")` OR `status === "ready"` |
| `canEdit` | `can("resource.write")` AND `status === "draft"` |
| `showPalette` | same as `canEdit` |
| `canImport` | same as `canEdit` |
| `canExport` | `can("resource.write")` (observers: false) |
| `canPublish` | `can("resource.write")` |
| `canDelete` | `can("resource.delete")` AND `status === "draft"` |

**Full role × status matrix:**

| Role | Status | readOnly | canEdit | showPalette | canImport | canExport | canDelete |
|---|---|---|---|---|---|---|---|
| observer | draft | ✓ | — | — | — | — | — |
| observer | ready | ✓ | — | — | — | — | — |
| contributor | draft | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| contributor | ready | ✓ | — | — | — | ✓ | — |
| maintainer | draft | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| maintainer | ready | ✓ | — | — | — | ✓ | — |

This file gets a companion `workflow-capabilities.test.ts` exercising all 6 combinations (3 roles × 2 statuses).

### 2. Delete: list → editor view

**Remove** `handleDelete` + the delete button from `packages/web/src/routes/FlowsListPage.tsx`.

**Add** a "Delete workflow" danger button to the topbar in `packages/flow-editor/src/topbar/Topbar.tsx`:
- Rendered only when `canDelete` prop is true.
- Confirms via `window.confirm`, calls `onDelete()` callback.
- After deletion, `FlowEditorPage` navigates back to the list.

### 3. Palette visibility

In `packages/flow-editor/src/FlowEditor.tsx`, pass `showPalette` (derived from capabilities) to the Palette. In `packages/flow-editor/src/palette/Palette.tsx`, render `null` when `showPalette` is false.

Today the Palette has no visibility prop — one needs to be added.

### 4. Toolbar cleanup

`FlowEditorPage` resolves capabilities via the new helper and passes each as a discrete prop to the `Topbar`:
- `onImport` → `canImport ? handler : undefined` (existing pattern, no change needed)
- `onExport` → `canExport ? handler : undefined` (new check replacing raw `effectiveReadOnly`)
- `onDelete` → `canDelete ? handler : undefined` (new)

Observer gets `undefined` for every action prop — the topbar renders a bare canvas with no buttons.

### 5. Backend guard

`DELETE /workspaces/:wsId/workflows/:id` in `packages/api-server/src/routes/flows.ts` loads the workflow, checks `workflow.status === "draft"`, and returns `409 { error: "not_draft" }` if not. This enforces the invariant server-side independent of the UI.

No migration needed — no schema change.

---

## File Impact

| File | Change |
|---|---|
| `packages/web/src/lib/workflow-capabilities.ts` | **New** — pure helper + types |
| `packages/web/src/lib/workflow-capabilities.test.ts` | **New** — full matrix unit test |
| `packages/web/src/routes/FlowsListPage.tsx` | Remove delete button + handler |
| `packages/web/src/routes/FlowEditorPage.tsx` | Resolve capabilities, pass to Topbar + FlowEditor |
| `packages/flow-editor/src/FlowEditor.tsx` | Accept + pass `showPalette` prop |
| `packages/flow-editor/src/palette/Palette.tsx` | Accept `visible` prop, render null when false |
| `packages/flow-editor/src/topbar/Topbar.tsx` | Add `onDelete` prop + Delete button |
| `packages/api-server/src/routes/flows.ts` | Add draft-status guard to DELETE handler |

---

## Non-Goals

- No changes to role assignments or the permission model itself.
- No custom-role or per-workflow ACL work.
- No change to the "ready" flow UX beyond what is described (publish/unpublish flows unchanged).
