# Version History UI — Redesign

**Date:** 2026-06-20
**Status:** Approved (design); implementation plan to follow
**Scope:** Make version history a first-class part of the `FlowEditor` (toolbar icon + drop-down panel), replacing the floating button + inline-styled panel currently in `FlowEditorPage`.

## Problem

The version-history feature was bolted onto `FlowEditorPage` as a `position: absolute`
`<button>` floating over the canvas, plus a `VersionHistoryPanel` with inline styles —
all outside the `FlowEditor` component. It overlaps the toolbar, ignores the editor's
established `IconButton` + slide-in-panel patterns (`ExportPanel`, `ImportPanel`,
`ValidationPanel`), and looks out of place.

## Decisions (locked during brainstorming)

1. Scope is **fit-and-finish + richer rows** (clearer state, relative time, author) —
   not a rework of the publish flow.
2. Form factor: **drop-down panel under the toolbar**, reusing the existing
   `je-*-panel` pattern (the same pattern as View JSON / Import).
3. The panel lists **promoted versions only**. No draft row, no second Promote button —
   promoting stays solely on the existing toolbar Publish button (decision A).

## Design

### Trigger — toolbar icon button

- A `History` (lucide) `IconButton` in `Topbar`, grouped with the other tool icons
  (Workflow setup / View JSON / Import), just left of **Run**.
- Tooltip "Version history" (same pattern as siblings).
- A small count badge shows the number of saved versions (hidden when zero).
- The floating `position: absolute` button in `FlowEditorPage` is **deleted**.

### Panel — drop-down under the toolbar

- New `je-history-panel`, styled to match `je-export-panel` (full width, drops below
  the toolbar, `max-height: 50vh`, scrolls).
- Header: "Version history · N versions" + a close ✕.

### Rows — clean, two-line, state markers (newest first)

- Left: a round marker — green ✓ for the live version, hollow circle for older ones.
- Line 1: **Version N** + a green **Live** tag on the published one.
- Line 2: muted "promoted {relative time} by {author}".
- Right: a ghost **Restore** button on every row **except** the live one (you can't
  restore what is already live). Restore is shown only when the caller is allowed to
  publish (the `onRollback` callback is provided).

### Restore confirmation — inline, no modal

- Clicking **Restore** swaps that row's button for an inline "Confirm restore? · Cancel"
  two-step, so a misclick can't change what runs. Confirm calls `onRollback(versionId)`.

### Empty state

- Before the first publish: "No versions yet. Publish to create the first version."

## Architecture / code shape

- **Data down, events up** (matches `flow`/`status`/`onPublish`):
  - `FlowEditorPage` fetches the version list via react-query
    (`["flow-versions", id]`) and passes `versions: WorkflowVersionSummary[]` plus
    `onRollback?: (versionId) => Promise<void>` into `FlowEditor`.
  - `FlowEditor` owns the open/close state (`historyOpen`), passes `onHistoryClick` +
    `versionCount` to `Topbar`, and renders the panel from the `versions` prop.
  - `VersionHistoryPanel` (moved into `packages/flow-editor`) is **presentational**:
    it receives `versions`, `onRollback`, `onClose`, and only manages inline-confirm
    state. No data fetching inside `flow-editor`.
- `WorkflowVersionSummary` moves to `@journeyman/core` so both `web` and `flow-editor`
  share one type (avoids a `flow-editor → web` import).
- After a successful rollback, `FlowEditorPage` invalidates `["flow-versions", id]`;
  the refreshed list flows back down and the panel + badge update.
- `IconButton` gains an optional `badge?: number` (renders a small count via
  `.je-icon-btn__badge`; the wrap is already `position: relative`).

### Removed

- `packages/web/src/components/VersionHistoryPanel.tsx`.
- The floating history `<button>` and `historyOpen` state in `FlowEditorPage`.

## Out of scope

- Viewing an old version read-only in the canvas.
- Diffing two versions.
- Version labels / notes.

## Implementation constraints (from requester)

- Work on the `master` branch only; do not create branches.
- Do not commit.
- Run typecheck (`npm run check` / `npm run typecheck`) once at the end.
