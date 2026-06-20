# Logs Panel — Bottom Resize Edge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `resizeEdge` prop to `WorkflowLogsPanel` so the agent run detail page can show the drag handle at the bottom of the log list (drag down = expand) instead of the top.

**Architecture:** Two files change. `WorkflowLogsPanel` gains a `resizeEdge?: 'top' | 'bottom'` prop (default `'top'`, preserving existing behaviour); the handle div is conditionally rendered before or after the log list, and the drag calculation flips sign for `'bottom'`. A self-contained CSS import is added to the component so styles load automatically. `AgentRunDetailPage` passes `resizeEdge="bottom"`.

**Tech Stack:** React 19, TypeScript, Vite (workspace monorepo), CSS classes scoped to `je-runview__*`

---

## File map

| File | What changes |
|---|---|
| `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx` | CSS import, `resizeEdge` prop, conditional drag math, conditional handle position |
| `packages/web/src/routes/AgentRunDetailPage.tsx` | Pass `resizeEdge="bottom"` |

---

### Task 1: Import CSS inside the component (self-contained styles)

**Files:**
- Modify: `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx` (top of file)

- [ ] **Step 1: Add the CSS import as the first import line**

Open `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx`. The file currently starts:

```ts
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkflowInstanceEvent, WorkflowNode } from "@journeyman/core";
import { parseLogs } from "./parse-logs.ts";
```

Add a CSS import before all other imports:

```ts
import "../styles.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkflowInstanceEvent, WorkflowNode } from "@journeyman/core";
import { parseLogs } from "./parse-logs.ts";
```

This makes styles self-contained — Vite deduplicates the injection so it loads exactly once regardless of how many times the component is used on the page.

---

### Task 2: Add `resizeEdge` prop, flip drag math, move handle conditionally

**Files:**
- Modify: `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx`

- [ ] **Step 1: Add `resizeEdge` to the props interface**

The `WorkflowLogsPanelProps` interface currently ends at `hideStepChips`. Add the new optional prop:

```ts
export interface WorkflowLogsPanelProps {
  events: WorkflowInstanceEvent[];
  nodes: WorkflowNode[];
  height: number;
  onResizeHeight: (next: number) => void;
  onClose: () => void;
  /** When true, the step-chips filter row is not rendered (use for single-step runs). */
  hideStepChips?: boolean;
  /**
   * Which edge carries the drag handle.
   * 'top'    — handle above the toolbar; drag up = expand (default, for fixed-bottom canvas layouts).
   * 'bottom' — handle below the log list; drag down = expand (for inline scrollable-page layouts).
   */
  resizeEdge?: 'top' | 'bottom';
}
```

- [ ] **Step 2: Flip the drag calculation for `'bottom'`**

Inside the `useEffect` at approximately line 87, the `onMove` handler currently reads:

```ts
const onMove = (ev: MouseEvent) => {
  if (!dragRef.current) return;
  const dy = ev.clientY - dragRef.current.startY;
  props.onResizeHeight(dragRef.current.startHeight - dy);
};
```

Replace it with a conditional that checks `resizeEdge`:

```ts
const onMove = (ev: MouseEvent) => {
  if (!dragRef.current) return;
  const dy = ev.clientY - dragRef.current.startY;
  const next = props.resizeEdge === 'bottom'
    ? dragRef.current.startHeight + dy
    : dragRef.current.startHeight - dy;
  props.onResizeHeight(next);
};
```

`dy` is positive when the mouse moves downward. For `'top'` (existing): drag down → shrink (panel top edge moves toward content). For `'bottom'` (new): drag down → grow (panel bottom edge extends away from content).

- [ ] **Step 3: Extract the handle to a local constant**

In the `return` block, the handle is currently an inline element at the top of the panel div (around line 162):

```tsx
<div
  className="je-runview__logspanel-handle"
  onMouseDown={onHandleMouseDown}
  title="Drag to resize"
>
  <span /><span /><span />
</div>
```

Before the `return` statement, extract it as a constant:

```tsx
const handle = (
  <div
    className="je-runview__logspanel-handle"
    onMouseDown={onHandleMouseDown}
    title="Drag to resize"
  >
    <span /><span /><span />
  </div>
);
```

- [ ] **Step 4: Render the handle at the correct edge**

The `return` block currently opens with the handle above the header. Replace the static handle with conditional placement:

```tsx
return (
  <div className="je-runview__logspanel" style={{ height: props.height }}>
    {props.resizeEdge !== 'bottom' && handle}

    <div className="je-runview__logspanel-header">
      {/* ... existing header content unchanged ... */}
    </div>

    {/* ... existing filter chips unchanged ... */}

    <div ref={scrollerRef} className="je-runview__log je-runview__logspanel-list">
      {/* ... existing log list content unchanged ... */}
    </div>

    {props.resizeEdge === 'bottom' && handle}
  </div>
);
```

The only structural change is: the static handle div at the top is replaced by `{props.resizeEdge !== 'bottom' && handle}`, and `{props.resizeEdge === 'bottom' && handle}` is added after the log list div. All content between those two points (header, filter chips, log list) is untouched.

---

### Task 3: Pass `resizeEdge="bottom"` on the agent run page

**Files:**
- Modify: `packages/web/src/routes/AgentRunDetailPage.tsx`

- [ ] **Step 1: Add the prop to the `WorkflowLogsPanel` call**

Around line 190, the call currently reads:

```tsx
<WorkflowLogsPanel
  events={allEvents}
  nodes={[]}
  height={logHeight}
  onResizeHeight={setLogHeight}
  onClose={() => {}}
  hideStepChips
/>
```

Add `resizeEdge="bottom"`:

```tsx
<WorkflowLogsPanel
  events={allEvents}
  nodes={[]}
  height={logHeight}
  onResizeHeight={setLogHeight}
  onClose={() => {}}
  hideStepChips
  resizeEdge="bottom"
/>
```

---

### Task 4: Typecheck

**Files:** none (read-only verification step)

- [ ] **Step 1: Run the monorepo typecheck**

```bash
npm run typecheck
```

Expected: zero errors. The new `resizeEdge` prop is optional with a string-literal union type — no consumer is required to update. `AgentRunDetailPage` passes a valid literal. `RunDetailPage` and `WorkflowInstanceViewer` omit the prop, which falls back to `'top'` (existing behaviour).

If errors appear, they will be in one of two places:
- `WorkflowLogsPanel.tsx` — check that `props.resizeEdge` is referenced correctly (no typos in the string literals `'top'` / `'bottom'`).
- `AgentRunDetailPage.tsx` — check that `resizeEdge="bottom"` matches the declared union type exactly.
