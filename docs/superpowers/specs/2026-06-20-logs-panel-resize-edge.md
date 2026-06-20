# Logs Panel — Bottom Resize Edge for Embedded Context

**Date:** 2026-06-20
**Status:** Approved

## Problem

`WorkflowLogsPanel` renders its drag handle at the top of the panel (above the toolbar). This is correct for `RunDetailPage`, where the panel is pinned to the bottom of a fixed-height canvas — dragging upward expands the panel into the canvas above it.

On `AgentRunDetailPage` the panel is inline content in a scrollable page. The top handle is counterintuitive there: you must drag upward to expand and downward to shrink, the opposite of what users expect when looking at a panel at the bottom of a page. The handle is also visually detached from the log content it's meant to resize.

A second issue was discovered during investigation: the run-viewer `styles.css` was not imported anywhere, so the handle had no height or cursor — it was invisible and unclickable. The fix must address both the missing styles and the inverted drag direction.

## Solution

### 1. `resizeEdge` prop on `WorkflowLogsPanel`

Add an optional prop `resizeEdge?: 'top' | 'bottom'` (default `'top'`).

| Value | Handle position | Drag math | Use case |
|---|---|---|---|
| `'top'` (default) | Above the toolbar | `startHeight - dy` | RunDetailPage fixed-canvas layout |
| `'bottom'` | Below the log list | `startHeight + dy` | AgentRunDetailPage scrollable page |

The handle div is conditionally rendered before or after the log list in JSX. The drag calculation changes based on the prop.

### 2. `AgentRunDetailPage` passes `resizeEdge="bottom"`

One-line change at the `WorkflowLogsPanel` call site.

### 3. Self-contained CSS import

`WorkflowLogsPanel.tsx` imports `../styles.css` directly (a relative import inside the package). Vite injects it once regardless of how many times the component is used. This replaces the previous approach of requiring the consumer (`main.tsx`) to import the stylesheet manually, which caused global CSS side effects. No `package.json` exports entry needed.

## What is not changing

- `RunDetailPage` / `WorkflowInstanceViewer` behaviour is unchanged (default `resizeEdge="top"`).
- No changes to drag logic, height state, or auto-scroll in `RunDetailPage`.
- The CSS file content itself is unchanged.

## Files touched

| File | Change |
|---|---|
| `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx` | Add `resizeEdge` prop; conditional handle position + drag math; add CSS import |
| `packages/web/src/routes/AgentRunDetailPage.tsx` | Pass `resizeEdge="bottom"` |

## Acceptance criteria

- On the agent run detail page, the drag handle appears below the log list.
- Dragging down expands the panel; dragging up shrinks it.
- The handle has the correct `row-resize` cursor (styles applied via component-level import).
- On the run detail page / flow run viewer, behaviour is unchanged.
