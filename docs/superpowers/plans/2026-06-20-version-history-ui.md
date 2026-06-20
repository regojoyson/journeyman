# Version History UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating version-history button + inline panel with a first-class `FlowEditor` toolbar icon and a drop-down panel matching the editor's existing patterns.

**Architecture:** Data down / events up. `FlowEditorPage` fetches versions (react-query) and passes `versions` + `onRollback` into `FlowEditor`; `FlowEditor` owns open/close state and renders a presentational `VersionHistoryPanel` (moved into `packages/flow-editor`) styled like `ExportPanel`. `WorkflowVersionSummary` moves to `@journeyman/core` so `web` and `flow-editor` share one type.

**Tech Stack:** TypeScript, React + @tanstack/react-query, lucide-react icons, Vitest, plain CSS (`packages/flow-editor/src/styles.css`).

**Requester constraints (override skill defaults):**
- Work on the `master` branch only. Do **not** create branches.
- Do **not** commit. (All commit ceremony omitted.)
- Run typecheck once at the end (Task 8).

Spec: [docs/superpowers/specs/2026-06-20-version-history-ui-design.md](../specs/2026-06-20-version-history-ui-design.md)

---

## File Structure

**Modify:**
- `packages/core/src/types/flow.types.ts` — add `WorkflowVersionSummary`.
- `packages/core/src/index.ts` — export it (already does `export * from "./types/flow.types.ts"` for types via the `export type {…}` block; add the name).
- `packages/web/src/api/flows.ts` — import `WorkflowVersionSummary` from core (drop local copy).
- `packages/flow-editor/src/types.ts` — add `versions` / `onRollback` to `FlowEditorProps`.
- `packages/flow-editor/src/topbar/IconButton.tsx` — optional `badge`.
- `packages/flow-editor/src/topbar/Topbar.tsx` — history `IconButton` + props.
- `packages/flow-editor/src/FlowEditor.tsx` — `historyOpen` state, wire Topbar + render panel.
- `packages/flow-editor/src/styles.css` — `.je-history-panel*` + `.je-icon-btn__badge`.
- `packages/web/src/routes/FlowEditorPage.tsx` — versions query, pass props, remove floating button.

**Create:**
- `packages/flow-editor/src/topbar/VersionHistoryPanel.tsx` — presentational panel.
- `packages/flow-editor/src/topbar/relative-time.ts` — pure `formatRelativeTime`.
- `packages/flow-editor/src/topbar/relative-time.test.ts` — unit test.

**Delete:**
- `packages/web/src/components/VersionHistoryPanel.tsx`.

---

## Task 1: Shared `WorkflowVersionSummary` type in core

**Files:**
- Modify: `packages/core/src/types/flow.types.ts`
- Modify: `packages/core/src/index.ts:141-149`
- Modify: `packages/web/src/api/flows.ts`

- [ ] **Step 1: Add the type in core**

Append to `packages/core/src/types/flow.types.ts` (after the `WorkflowVersion` interface, near line 170):

```typescript
/** Lightweight version row for the history list (no definition payload). */
export interface WorkflowVersionSummary {
  id: string;
  versionNumber: number;
  /** ISO timestamp string (serialized over the wire). */
  createdAt: string;
  createdByUserId: string | null;
  isPublished: boolean;
}
```

- [ ] **Step 2: Export from the core barrel**

In `packages/core/src/index.ts`, add `WorkflowVersionSummary` to the existing `export type { … } from "./types/flow.types.ts";` block (the one starting near line 141 that already lists `Workflow, WorkflowGraph, …`):

```typescript
export type {
  Workflow, WorkflowGraph, WorkflowEdge, WorkflowEdgeType, WorkflowNode, WorkflowNodeType, WorkflowVersion,
  WorkflowVersionSummary,
  WorkflowSchemaVersion,
  RetryPolicy, WorkflowRetryPolicy, BackoffStrategy,
  McpServerConfig, McpTransport, WorkflowInputValue, WorkflowInputDef, WorkflowAttributeDef,
  WorkflowSaveWarning,
  SecretBinding,
  WorkflowDefaults,
} from "./types/flow.types.ts";
```

- [ ] **Step 3: Use the shared type in the web client**

In `packages/web/src/api/flows.ts`, delete the local `WorkflowVersionSummary` interface and import it from core instead. Change the top import line:

```typescript
import type { Workflow, WorkflowGraph, WorkflowSaveWarning, WorkflowVersion, PublishError, WorkflowVersionSummary } from "@journeyman/core";
```

Delete this block (the local definition):

```typescript
export interface WorkflowVersionSummary {
  id: string;
  versionNumber: number;
  createdAt: string;
  createdByUserId: string | null;
  isPublished: boolean;
}
```

Re-export it so existing importers (`./api/flows.ts` consumers) keep working — add below the imports:

```typescript
export type { WorkflowVersionSummary } from "@journeyman/core";
```

`listWorkflowVersions` keeps its current signature (returns `WorkflowVersionSummary[]`).

---

## Task 2: Pure relative-time helper + unit test

**Files:**
- Create: `packages/flow-editor/src/topbar/relative-time.ts`
- Test: `packages/flow-editor/src/topbar/relative-time.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/flow-editor/src/topbar/relative-time.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "./relative-time.ts";

const now = new Date("2026-06-20T12:00:00Z").getTime();

describe("formatRelativeTime", () => {
  it("shows 'just now' under a minute", () => {
    expect(formatRelativeTime("2026-06-20T11:59:40Z", now)).toBe("just now");
  });
  it("shows minutes", () => {
    expect(formatRelativeTime("2026-06-20T11:45:00Z", now)).toBe("15m ago");
  });
  it("shows hours", () => {
    expect(formatRelativeTime("2026-06-20T10:00:00Z", now)).toBe("2h ago");
  });
  it("shows days", () => {
    expect(formatRelativeTime("2026-06-18T12:00:00Z", now)).toBe("2d ago");
  });
  it("falls back to a date past a week", () => {
    expect(formatRelativeTime("2026-06-01T12:00:00Z", now)).toMatch(/2026|Jun/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/flow-editor && npx vitest run relative-time`
Expected: FAIL — `Cannot find module './relative-time.ts'`.

- [ ] **Step 3: Implement the helper**

Create `packages/flow-editor/src/topbar/relative-time.ts`:

```typescript
/** Compact relative time ("just now", "15m ago", "2h ago", "3d ago") with a date fallback past a week. */
export function formatRelativeTime(iso: string, nowMs: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, nowMs - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(then).toLocaleDateString();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/flow-editor && npx vitest run relative-time`
Expected: PASS (5 assertions).

---

## Task 3: `IconButton` count badge

**Files:**
- Modify: `packages/flow-editor/src/topbar/IconButton.tsx`
- Modify: `packages/flow-editor/src/styles.css`

- [ ] **Step 1: Add the `badge` prop**

In `packages/flow-editor/src/topbar/IconButton.tsx`, add `badge` to the props interface:

```typescript
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  hint?: string;
  icon: ReactNode;
  tooltipPlacement?: "bottom" | "top";
  busy?: boolean;
  /** Optional count rendered as a small badge on the button corner. Hidden when 0/undefined. */
  badge?: number;
}
```

Destructure `badge` in the function signature (add it to the existing destructure list):

```typescript
  { label, hint, icon, tooltipPlacement = "bottom", busy, badge, className, onKeyDown, ...rest },
```

Render the badge inside the `je-icon-btn-wrap` span, immediately after the closing `</button>` and before the tooltip block:

```tsx
      {badge ? <span className="je-icon-btn__badge" aria-hidden="true">{badge}</span> : null}
```

- [ ] **Step 2: Add badge CSS**

In `packages/flow-editor/src/styles.css`, after the `.je-icon-btn-wrap { … }` rule (around line 166), add:

```css
.je-icon-btn__badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 8px;
  background: rgb(var(--color-accent) / 1);
  color: #fff;
  font-size: 9px;
  font-weight: 600;
  line-height: 15px;
  text-align: center;
  border: 2px solid rgb(var(--color-bg) / 1);
  pointer-events: none;
}
```

---

## Task 4: `VersionHistoryPanel` in flow-editor

**Files:**
- Create: `packages/flow-editor/src/topbar/VersionHistoryPanel.tsx`
- Modify: `packages/flow-editor/src/styles.css`

- [ ] **Step 1: Create the presentational panel**

Create `packages/flow-editor/src/topbar/VersionHistoryPanel.tsx`:

```tsx
import { useState } from "react";
import { X, Check, Circle, RotateCcw } from "lucide-react";
import type { WorkflowVersionSummary } from "@journeyman/core";
import { formatRelativeTime } from "./relative-time.ts";

export interface VersionHistoryPanelProps {
  versions: WorkflowVersionSummary[];
  /** When provided, Restore buttons are shown on non-live rows. */
  onRollback?: (versionId: string) => void | Promise<void>;
  onClose: () => void;
}

export function VersionHistoryPanel({ versions, onRollback, onClose }: VersionHistoryPanelProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const ordered = [...versions].sort((a, b) => b.versionNumber - a.versionNumber);

  const doRollback = async (id: string) => {
    if (!onRollback) return;
    setBusyId(id);
    try {
      await onRollback(id);
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  };

  return (
    <div className="je-history-panel">
      <div className="je-history-panel__header">
        <span className="je-history-panel__title">Version history</span>
        <span className="je-history-panel__count">
          {versions.length} version{versions.length === 1 ? "" : "s"}
        </span>
        <span className="je-history-panel__spacer" />
        <button type="button" className="je-history-panel__close" aria-label="Close version history" onClick={onClose}>
          <X size={15} aria-hidden="true" focusable="false" />
        </button>
      </div>

      {ordered.length === 0 ? (
        <div className="je-history-panel__empty">No versions yet. Publish to create the first version.</div>
      ) : (
        <div className="je-history-panel__list">
          {ordered.map((v) => (
            <div key={v.id} className="je-history-row">
              <span className={`je-history-row__marker${v.isPublished ? " is-live" : ""}`}>
                {v.isPublished
                  ? <Check size={14} aria-hidden="true" focusable="false" />
                  : <Circle size={13} aria-hidden="true" focusable="false" />}
              </span>
              <span className="je-history-row__info">
                <span className="je-history-row__line1">
                  <span className="je-history-row__title">Version {v.versionNumber}</span>
                  {v.isPublished && <span className="je-history-row__tag">Live</span>}
                </span>
                <span className="je-history-row__sub">
                  {v.createdByUserId
                    ? `${formatRelativeTime(v.createdAt)} by ${v.createdByUserId}`
                    : formatRelativeTime(v.createdAt)}
                </span>
              </span>
              {onRollback && !v.isPublished && (
                <span className="je-history-row__act">
                  {confirmId === v.id ? (
                    <>
                      <button type="button" className="je-history-btn je-history-btn--primary" disabled={busyId === v.id} onClick={() => doRollback(v.id)}>
                        Confirm restore
                      </button>
                      <button type="button" className="je-history-btn" disabled={busyId === v.id} onClick={() => setConfirmId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className="je-history-btn" onClick={() => setConfirmId(v.id)}>
                      <RotateCcw size={13} aria-hidden="true" focusable="false" /> Restore
                    </button>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the panel CSS**

In `packages/flow-editor/src/styles.css`, after the `.je-export-panel { … }` block (around line 978), add:

```css
.je-history-panel {
  background: rgb(var(--color-bg) / 1);
  border-bottom: 1px solid rgb(var(--color-border) / 1);
  display: flex;
  flex-direction: column;
  max-height: 50vh;
  overflow-y: auto;
}
.je-history-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid rgb(var(--color-border) / 1);
}
.je-history-panel__title { font-size: 13px; font-weight: 600; }
.je-history-panel__count { font-size: 11px; color: rgb(var(--color-text-muted) / 1); }
.je-history-panel__spacer { flex: 1; }
.je-history-panel__close {
  display: inline-flex; align-items: center; justify-content: center;
  color: rgb(var(--color-text-muted) / 1); padding: 4px; border-radius: 6px;
}
.je-history-panel__close:hover { background: rgb(var(--color-surface-hover) / 1); color: rgb(var(--color-text) / 1); }
.je-history-panel__empty { padding: 18px 16px; font-size: 12px; color: rgb(var(--color-text-muted) / 1); }
.je-history-panel__list { display: flex; flex-direction: column; }

.je-history-row { display: flex; align-items: center; gap: 12px; padding: 11px 16px; border-top: 1px solid rgb(var(--color-border) / 0.5); }
.je-history-row:first-child { border-top: none; }
.je-history-row__marker {
  width: 26px; height: 26px; border-radius: 50%; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
  background: rgb(var(--color-surface-raised) / 1); border: 1px solid rgb(var(--color-border) / 1);
  color: rgb(var(--color-text-muted) / 1);
}
.je-history-row__marker.is-live { background: rgb(var(--color-success) / 0.16); border-color: transparent; color: rgb(var(--color-success) / 1); }
.je-history-row__info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.je-history-row__line1 { display: flex; align-items: center; gap: 8px; }
.je-history-row__title { font-size: 13px; font-weight: 500; }
.je-history-row__tag { font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: rgb(var(--color-success) / 0.16); color: rgb(var(--color-success) / 1); }
.je-history-row__sub { font-size: 11.5px; color: rgb(var(--color-text-muted) / 1); }
.je-history-row__act { margin-left: auto; display: inline-flex; gap: 6px; flex: 0 0 auto; }
.je-history-btn {
  font-size: 12px; padding: 5px 11px; border-radius: 7px;
  border: 1px solid rgb(var(--color-border) / 1); background: transparent; color: rgb(var(--color-text) / 1);
  display: inline-flex; align-items: center; gap: 6px;
}
.je-history-btn:hover:not(:disabled) { border-color: rgb(var(--color-border-strong) / 1); }
.je-history-btn--primary { background: rgb(var(--color-accent) / 1); border-color: rgb(var(--color-accent) / 1); color: #fff; }
.je-history-btn:disabled { opacity: 0.6; }
```

---

## Task 5: Wire history into `Topbar`

**Files:**
- Modify: `packages/flow-editor/src/topbar/Topbar.tsx`

- [ ] **Step 1: Add the lucide import**

In `Topbar.tsx`, add `History` to the existing `lucide-react` import block (alongside `Play`, `Save`, etc.):

```typescript
import {
  Check,
  Copy,
  Download,
  FileCode2,
  History,
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

- [ ] **Step 2: Add props to `TopbarProps`**

Add to the `TopbarProps` interface:

```typescript
  /** Opens the version-history panel. When omitted, the history button is hidden. */
  onHistoryClick?: () => void;
  /** Count shown as a badge on the history button. Hidden when 0/undefined. */
  versionCount?: number;
```

- [ ] **Step 3: Render the history button**

In the toolbar, immediately before the `{p.onWorkflowSetup && (` block, add:

```tsx
        {p.onHistoryClick && (
          <IconButton
            className="je-icon-btn--history"
            label="Version history"
            hint="View and restore promoted versions"
            badge={p.versionCount}
            icon={<History size={16} aria-hidden="true" focusable="false" />}
            onClick={p.onHistoryClick}
          />
        )}
```

---

## Task 6: Wire history into `FlowEditor`

**Files:**
- Modify: `packages/flow-editor/src/types.ts`
- Modify: `packages/flow-editor/src/FlowEditor.tsx`

- [ ] **Step 1: Extend `FlowEditorProps`**

In `packages/flow-editor/src/types.ts`, add the import and two props. Update the top import:

```typescript
import type { WorkflowGraph, WorkflowNodeType, WorkflowSaveWarning, WorkflowStatus, McpTransport, PublishError, WorkflowVersionSummary } from "@journeyman/core";
```

Add to the `FlowEditorProps` interface (after `onUnpublish`):

```typescript
  /** Promoted version history, newest-or-any order. When provided, the history toolbar button appears. */
  versions?: WorkflowVersionSummary[];
  /** Restore (rollback) the live pointer to an existing version. When provided, Restore buttons show. */
  onRollback?: (versionId: string) => void | Promise<void>;
```

- [ ] **Step 2: Import the panel and add open state**

In `FlowEditor.tsx`, add the import near the other topbar imports:

```typescript
import { VersionHistoryPanel } from "./topbar/VersionHistoryPanel.tsx";
```

Add state next to `const [setupOpen, setSetupOpen] = useState(false);`:

```typescript
  const [historyOpen, setHistoryOpen] = useState(false);
```

- [ ] **Step 3: Pass props to `Topbar`**

In the `<Topbar … />` element, add (next to `onWorkflowSetup`):

```tsx
          onHistoryClick={props.versions ? () => setHistoryOpen(true) : undefined}
          versionCount={props.versions?.length}
```

- [ ] **Step 4: Render the panel**

Immediately after the `<Topbar … />` element's closing tag, add:

```tsx
        {historyOpen && props.versions && (
          <VersionHistoryPanel
            versions={props.versions}
            onRollback={props.onRollback}
            onClose={() => setHistoryOpen(false)}
          />
        )}
```

---

## Task 7: Update `FlowEditorPage`, remove the old panel + floating button

**Files:**
- Modify: `packages/web/src/routes/FlowEditorPage.tsx`
- Delete: `packages/web/src/components/VersionHistoryPanel.tsx`

- [ ] **Step 1: Replace the old import**

In `FlowEditorPage.tsx`, change the panel import line:

```typescript
import { listWorkflowVersions } from "../api/flows.ts";
```

(Remove `import { VersionHistoryPanel } from "../components/VersionHistoryPanel.tsx";`.)

Ensure `useQuery` is imported (it already is) and that `listWorkflowVersions` joins the existing `../api/flows.ts` import — if the file already imports several names from `../api/flows.ts`, add `listWorkflowVersions` to that block instead of a second import.

- [ ] **Step 2: Add the versions query**

After the existing `flowQ` query, add:

```typescript
  const versionsQ = useQuery({
    queryKey: ["flow-versions", id],
    queryFn: () => listWorkflowVersions(wsId, id!),
    enabled: !!id,
  });
```

- [ ] **Step 3: Remove the floating-button state and `relative` wrapper hack**

Delete the `const [historyOpen, setHistoryOpen] = useState(false);` line.

Remove `position: "relative"` from the outer wrapper div's style if it was only added for the floating button (leave the rest of the style intact):

```tsx
      <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
```

- [ ] **Step 4: Delete the floating button + old panel JSX**

Remove this block that was added previously (the `caps.canPublish` history button and the `<VersionHistoryPanel … />`):

```tsx
        {caps.canPublish && (
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            style={{ position: "absolute", top: 8, right: 12, zIndex: 5 }}
          >
            {historyOpen ? "Hide history" : "Version history"}
          </button>
        )}
        {historyOpen && (
          <VersionHistoryPanel
            wsId={wsId}
            workflowId={flow.id}
            onRollback={onRollback}
            onClose={() => setHistoryOpen(false)}
          />
        )}
```

- [ ] **Step 5: Pass `versions` + `onRollback` into `<FlowEditor>`**

In the `<FlowEditor … />` element, add (next to `onPublish`/`onUnpublish`):

```tsx
            versions={versionsQ.data ?? []}
            onRollback={caps.canPublish ? onRollback : undefined}
```

The existing `onRollback` handler already invalidates `["flow-versions", id]` on success, so the badge and panel refresh after a restore. Keep it.

- [ ] **Step 6: Delete the obsolete web panel**

Delete the file `packages/web/src/components/VersionHistoryPanel.tsx`.

Run: `grep -rn "components/VersionHistoryPanel" packages/web/src`
Expected: no results (the only importer was `FlowEditorPage`, fixed in Step 1).

---

## Task 8: Typecheck + boundary + tests (single end gate)

**Files:** none

- [ ] **Step 1: Run the relative-time test**

Run: `cd packages/flow-editor && npx vitest run relative-time`
Expected: PASS (5 assertions).

- [ ] **Step 2: Run typecheck + boundaries**

Run: `npm run typecheck && npm run check:boundaries`
Expected: PASS, except the **pre-existing, unrelated** failures that exist before this work:
- `packages/notification-provider/src/providers/email/*` (untracked in-progress email provider)
- `packages/flow-editor/src/canvas/auto-populate-defaults.test.ts` (pre-existing `CustomAiStep` mismatch)

No **new** errors may reference `WorkflowVersionSummary`, `VersionHistoryPanel`, `versions`, `onRollback`, `onHistoryClick`, `badge`, or `relative-time`.

- [ ] **Step 3: Fix any new errors surfaced**

If typecheck reports an error in a file this plan touched, fix it in place and re-run until only the two pre-existing failures remain.

---

## Self-Review Notes (author)

- **Spec coverage:** toolbar icon + badge (Tasks 3, 5); drop-down panel matching `je-*-panel` (Task 4); two-line rows with markers + Live tag + relative time (Tasks 2, 4); Restore inline-confirm gated by `onRollback` (Task 4, 7); empty state (Task 4); data-down/events-up with shared core type (Tasks 1, 6, 7); removal of floating button + old web panel (Task 7). Promote stays on the existing toolbar button — no draft row (per decision A), nothing added for it.
- **Type consistency:** `WorkflowVersionSummary` defined once in core (Task 1), consumed by web (`listWorkflowVersions`) and flow-editor (`FlowEditorProps`, `VersionHistoryPanel`). Prop names `versions` / `onRollback` / `onHistoryClick` / `versionCount` / `badge` match across `types.ts`, `FlowEditor.tsx`, `Topbar.tsx`, `IconButton.tsx`, and `FlowEditorPage.tsx`.
- **Out of scope confirmed absent:** no read-only canvas view, no diff, no labels.
