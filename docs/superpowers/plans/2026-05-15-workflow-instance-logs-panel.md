# Workflow Instance Logs Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Chrome-DevTools-style bottom panel to the run viewer that aggregates logs across every phase of a workflow instance, with kind/phase/text filters, opened via a topbar toggle and drag-resizable in height.

**Architecture:** Purely a new view over data the `WorkflowInstanceViewer` already receives. A shared `parse-logs` helper is extracted from `PhaseLogsSection` and reused by both the per-phase view (in the right drawer, unchanged behavior) and the new `WorkflowLogsPanel` (bottom-docked). `RunViewer.tsx` owns open/height state with localStorage persistence. The new panel inlines its own top-edge vertical drag handle (the existing `PanelResizer` is horizontal-only and must not be modified).

**Tech Stack:** React 18 + TypeScript, no new deps, existing CSS-in-CSS via `packages/run-viewer/src/styles.css`.

**User-imposed constraints:**
- No commits during implementation — leave the worktree dirty.
- No unit tests — `parse-logs.test.ts` from the spec is dropped from this plan.
- Final task is a workspace-wide `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-05-15-workflow-instance-logs-panel-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `packages/run-viewer/src/logs/types.ts` | Create | `LogKind`, `ParsedLog` types |
| `packages/run-viewer/src/logs/parse-logs.ts` | Create | Pure event → `ParsedLog[]` parser (shared) |
| `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx` | Create | Bottom panel UI |
| `packages/run-viewer/src/drawer/PhaseLogsSection.tsx` | Modify | Use shared `parseLogs`; behavior unchanged |
| `packages/run-viewer/src/topbar/RunTopbar.tsx` | Modify | Add "Show/Hide logs" toggle button + count badge |
| `packages/run-viewer/src/RunViewer.tsx` | Modify | Layout: bottom row; owns `logsOpen` / `logsHeight` + localStorage |
| `packages/run-viewer/src/styles.css` | Modify | Styles for bottom panel, vertical drag handle, phase pill, search input |

---

## Task 1: Extract shared `parse-logs` helper

**Files:**
- Create: `packages/run-viewer/src/logs/types.ts`
- Create: `packages/run-viewer/src/logs/parse-logs.ts`

- [ ] **Step 1: Create `logs/types.ts`**

Create `packages/run-viewer/src/logs/types.ts`:

```ts
export type LogKind =
  | "assistant"
  | "tool"
  | "tool_result"
  | "result_ok"
  | "result_err"
  | "other";

export interface ParsedLog {
  /** Stable id from the source event. */
  id: number;
  ts: Date;
  /** nodeId of the phase that produced the event, or null for workflow-level events. */
  nodeId: string | null;
  /** Human-readable phase name; "Workflow" for events with no nodeId. */
  phaseName: string;
  /** The single-line log text (for phase.log: payload.line; for other events: synthesized). */
  line: string;
  kind: LogKind;
  meta?: Record<string, unknown>;
}

export const KIND_COLOR: Record<LogKind, string> = {
  assistant: "#74b9ff",
  tool: "#fdcb6e",
  tool_result: "#a4b0be",
  result_ok: "#55efc4",
  result_err: "#ff7675",
  other: "#ddd",
};

export const KIND_LABEL: Record<LogKind, string> = {
  assistant: "Assistant",
  tool: "Tools",
  tool_result: "Tool results",
  result_ok: "Results",
  result_err: "Errors",
  other: "Other",
};

export const ALL_KINDS: LogKind[] = [
  "assistant",
  "tool",
  "tool_result",
  "result_ok",
  "result_err",
  "other",
];
```

- [ ] **Step 2: Create `logs/parse-logs.ts`**

Create `packages/run-viewer/src/logs/parse-logs.ts`:

```ts
import type { WorkflowInstanceEvent, WorkflowNode } from "@journeyman/core";
import type { LogKind, ParsedLog } from "./types.ts";

function classifyLine(line: string): LogKind {
  if (line.startsWith("🤖")) return "assistant";
  if (line.startsWith("🔧")) return "tool";
  if (line.startsWith("📥")) return "tool_result";
  if (line.startsWith("✅")) return "result_ok";
  if (line.startsWith("❌")) return "result_err";
  return "other";
}

function resolvePhaseName(
  nodeId: string | null,
  nameByNodeId: Map<string, string>,
): string {
  if (!nodeId) return "Workflow";
  return nameByNodeId.get(nodeId) ?? nodeId;
}

/**
 * Build a nodeId → display name map using the same fallback chain as
 * RunViewer.tsx: displayName → phaseType → type → nodeId.
 */
function buildNameMap(nodes: WorkflowNode[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of nodes) {
    const name = n.displayName ?? n.phaseType ?? n.type ?? n.id;
    m.set(n.id, name);
  }
  return m;
}

function formatWorkflowEvent(ev: WorkflowInstanceEvent): string {
  const p = ev.payload as Record<string, unknown>;
  switch (ev.eventType) {
    case "workflow_instance.started":
      return "▶ workflow started";
    case "workflow_instance.completed":
      return "✅ workflow completed";
    case "workflow_instance.failed":
      return `❌ workflow failed${typeof p.error === "string" ? `: ${p.error}` : ""}`;
    case "workflow_instance.cancelled":
      return "⏹ workflow cancelled";
    case "phase.started":
      return "▶ phase started";
    case "phase.completed":
      return "✅ phase completed";
    case "phase.failed":
      return `❌ phase failed${typeof p.error === "string" ? `: ${p.error}` : ""}`;
    case "phase.retrying":
      return `↻ phase retrying${typeof p.attempt === "number" ? ` (attempt ${p.attempt})` : ""}`;
    case "phase.skipped":
      return "⤼ phase skipped";
    case "node.cycled":
      return "↻ node cycled";
    case "node.waiting":
      return "⏸ node waiting";
    case "node.resolved":
      return "✓ node resolved";
    case "edge.taken":
      return `→ edge taken${typeof p.edgeId === "string" ? ` (${p.edgeId})` : ""}`;
    case "condition.evaluated":
      return `? condition evaluated${typeof p.result !== "undefined" ? ` → ${String(p.result)}` : ""}`;
    case "worker.heartbeat":
      return "♥ worker heartbeat";
    case "task.polled":
      return "… task polled";
    case "task.dispatched":
      return "↗ task dispatched";
    default:
      return ev.eventType;
  }
}

/**
 * Parse a batch of workflow-instance events into a flat ParsedLog[] suitable
 * for both the per-phase view (PhaseLogsSection) and the cross-phase
 * WorkflowLogsPanel. Order is preserved.
 */
export function parseLogs(
  events: WorkflowInstanceEvent[],
  nodes: WorkflowNode[],
): ParsedLog[] {
  const nameByNodeId = buildNameMap(nodes);
  return events.map((ev): ParsedLog => {
    if (ev.eventType === "phase.log") {
      const payload = ev.payload as { line?: string; meta?: Record<string, unknown> };
      const line = payload.line ?? JSON.stringify(payload);
      return {
        id: ev.id,
        ts: ev.ts,
        nodeId: ev.nodeId,
        phaseName: resolvePhaseName(ev.nodeId, nameByNodeId),
        line,
        kind: classifyLine(line),
        meta: payload.meta,
      };
    }
    return {
      id: ev.id,
      ts: ev.ts,
      nodeId: ev.nodeId,
      phaseName: resolvePhaseName(ev.nodeId, nameByNodeId),
      line: formatWorkflowEvent(ev),
      kind: "other",
      meta: ev.payload as Record<string, unknown>,
    };
  });
}
```

Note: if `WorkflowNode` is not exported from `@journeyman/core`, replace the import with the local type used by `RunViewer.tsx`. Verify the import path by grepping: `grep -n "WorkflowNode" packages/core/src/index.ts packages/core/src/types/*.ts | head`. If the type is exported under a different name (e.g. `FlowNode`), adjust both the import and the parameter type accordingly.

---

## Task 2: Refactor `PhaseLogsSection` to use shared parser

**Files:**
- Modify: `packages/run-viewer/src/drawer/PhaseLogsSection.tsx`

The behavior must not change. We swap the inline parser/classifier for `parseLogs`, but the existing UI and filtering by `phase.log` only is preserved by pre-filtering events to `phase.log` before calling `parseLogs` (or by filtering kind chips to ignore non-`phase.log` records since they all classify to `other` and the row would still appear — we want to preserve current behavior, which is "phase.log only", so we pre-filter).

- [ ] **Step 1: Update imports**

In `packages/run-viewer/src/drawer/PhaseLogsSection.tsx`, replace the top of the file (lines 1–45 in the current file) so it reads:

```tsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkflowInstanceEvent } from "@journeyman/core";
import { parseLogs } from "../logs/parse-logs.ts";
import {
  ALL_KINDS,
  KIND_COLOR,
  KIND_LABEL,
  type LogKind,
  type ParsedLog,
} from "../logs/types.ts";

function fmtTime(d: Date): string {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleTimeString(undefined, { hour12: false });
}

const NEAR_BOTTOM_THRESHOLD = 24;
```

This removes the inline `LogKind`, `ParsedLog`, `KIND_COLOR`, `KIND_LABEL`, `classify` definitions that previously lived at the top of the file.

- [ ] **Step 2: Rewrite the `logs` memo to use `parseLogs`**

The component signature stays `function PhaseLogsSection({ events }: { events: WorkflowInstanceEvent[] })`. Replace the existing `logs` memo (currently lines 49–65) with:

```tsx
  const logs: ParsedLog[] = useMemo(
    () => parseLogs(
      events.filter(e => e.eventType === "phase.log"),
      [],
    ),
    [events],
  );
```

We pass `[]` for nodes because `PhaseLogsSection` doesn't render a phase name column — `phaseName` is unused in this view, so the empty nodes map is fine.

- [ ] **Step 3: Replace `allKinds` reference**

Within the same file, replace the local declaration `const allKinds: LogKind[] = [...]` with the imported `ALL_KINDS` constant. The JSX line that maps over kinds becomes:

```tsx
        {ALL_KINDS.map(k => {
```

Leave the rest of the component unchanged.

- [ ] **Step 4: Verify nothing else references the removed locals**

Run: `grep -n "classify\|KIND_COLOR\|KIND_LABEL\|allKinds" packages/run-viewer/src/drawer/PhaseLogsSection.tsx`
Expected: only the JSX usages of `KIND_COLOR`/`KIND_LABEL` (which now resolve to the imports) and the `ALL_KINDS` usage in the chip map remain. No standalone `classify(` calls, no `const allKinds =`, no `const KIND_` definitions.

---

## Task 3: Add `logsOpen` / `logsHeight` state and bottom-row layout to `RunViewer`

**Files:**
- Modify: `packages/run-viewer/src/RunViewer.tsx`

- [ ] **Step 1: Add constants and state**

In `packages/run-viewer/src/RunViewer.tsx`, just below the existing `DRAWER_WIDTH_*` constants (lines 13–16), add:

```ts
const LOGS_OPEN_KEY = "je-runview:logsOpen";
const LOGS_HEIGHT_KEY = "je-runview:logsHeight";
const LOGS_HEIGHT_DEFAULT = 240;
const LOGS_HEIGHT_MIN = 120;
function logsHeightMax(): number {
  if (typeof window === "undefined") return 800;
  return Math.max(LOGS_HEIGHT_MIN, Math.floor(window.innerHeight * 0.7));
}
```

Inside `WorkflowInstanceViewer`, just below the existing `drawerWidth` state hooks (after the `useEffect` that persists `drawerWidth`), add:

```tsx
  const [logsOpen, setLogsOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(LOGS_OPEN_KEY) === "1";
  });
  useEffect(() => {
    try { localStorage.setItem(LOGS_OPEN_KEY, logsOpen ? "1" : "0"); } catch { /* ignore */ }
  }, [logsOpen]);

  const [logsHeight, setLogsHeight] = useState<number>(() => {
    if (typeof window === "undefined") return LOGS_HEIGHT_DEFAULT;
    const stored = localStorage.getItem(LOGS_HEIGHT_KEY);
    const n = stored ? Number(stored) : NaN;
    const max = logsHeightMax();
    return Number.isFinite(n) && n >= LOGS_HEIGHT_MIN && n <= max ? n : LOGS_HEIGHT_DEFAULT;
  });
  useEffect(() => {
    try { localStorage.setItem(LOGS_HEIGHT_KEY, String(logsHeight)); } catch { /* ignore */ }
  }, [logsHeight]);
  // Clamp height if the viewport shrinks.
  useEffect(() => {
    const onResize = () => {
      const max = logsHeightMax();
      setLogsHeight(prev => Math.min(prev, max));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
```

- [ ] **Step 2: Compute total log count for the topbar badge**

Just below the `execsForSelected` memo, add:

```tsx
  const totalLogCount = props.events.length;
```

- [ ] **Step 3: Pass toggle + count props into `WorkflowInstanceTopbar`**

Update the topbar JSX in the same file to pass the new props (these will be added to the topbar in Task 4):

```tsx
      <WorkflowInstanceTopbar
        workflowName={props.workflowName ?? "Workflow Instance"}
        workflowInstance={props.workflowInstance}
        onRerun={props.onRerun}
        onCancel={props.onCancel}
        onPause={props.onPause}
        onResume={props.onResume}
        onExport={props.onExport}
        onFork={props.onFork}
        onRefresh={props.onRefresh}
        logsOpen={logsOpen}
        logsCount={totalLogCount}
        onToggleLogs={() => setLogsOpen(v => !v)}
      />
```

- [ ] **Step 4: Wrap body + bottom panel and import `WorkflowLogsPanel`**

At the top of the file, add the import:

```tsx
import { WorkflowLogsPanel } from "./logs/WorkflowLogsPanel.tsx";
```

Replace the existing `<div className="je-runview__body" ...>...</div>` element with the following block (this keeps the existing inner content of the body div verbatim and wraps it with a bottom panel sibling):

```tsx
      <div className="je-runview__body" style={{ gridTemplateColumns: `1fr 6px ${drawerWidth}px` }}>
        <ReadOnlyCanvas
          workflow={props.workflow}
          statuses={statuses}
          selectedNodeId={selectedNodeId}
          onSelect={setSelectedNodeId}
        />
        <PanelResizer
          width={drawerWidth}
          onResize={setDrawerWidth}
          side="right"
          min={DRAWER_WIDTH_MIN}
          max={DRAWER_WIDTH_MAX}
        />
        <NodeDetailDrawer
          nodeId={selectedNodeId}
          displayName={selectedDisplayName}
          status={selectedNodeId ? (statuses.get(selectedNodeId) ?? null) : null}
          events={eventsForSelected}
          executions={execsForSelected}
          onRetryStep={selectedNodeId && props.onRetryStep
            ? () => props.onRetryStep!(selectedNodeId)
            : undefined}
          pendingHumanTask={props.pendingHumanTask ?? null}
          onResolveHumanTask={props.onResolveHumanTask}
        />
      </div>
      {logsOpen && (
        <WorkflowLogsPanel
          events={props.events}
          nodes={props.workflow.nodes}
          height={logsHeight}
          onResizeHeight={(next) => {
            const max = logsHeightMax();
            setLogsHeight(Math.min(max, Math.max(LOGS_HEIGHT_MIN, next)));
          }}
          onClose={() => setLogsOpen(false)}
        />
      )}
```

Note: the bottom panel sits as a sibling of `je-runview__body`, inside the outer `je-runview` container. The outer container is a vertical flex/block; adding a sibling beneath naturally stacks it below the canvas/drawer row. CSS in Task 7 ensures `je-runview__body` shrinks to make room.

---

## Task 4: Add "Show/Hide logs" toggle to `RunTopbar`

**Files:**
- Modify: `packages/run-viewer/src/topbar/RunTopbar.tsx`

- [ ] **Step 1: Extend the props interface**

At the top of `packages/run-viewer/src/topbar/RunTopbar.tsx`, add three optional props to `WorkflowInstanceTopbarProps`:

```ts
export interface WorkflowInstanceTopbarProps {
  workflowName: string;
  workflowInstance: WorkflowInstance;
  onRerun?: () => void;
  onCancel?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onExport?: () => void;
  onFork?: () => void;
  onRefresh?: () => void;
  busy?: boolean;
  logsOpen?: boolean;
  logsCount?: number;
  onToggleLogs?: () => void;
}
```

- [ ] **Step 2: Render the toggle button**

Inside the component body, just before the final `{p.onRerun && (...)}` button (so the logs toggle ends up rightmost in the action group), insert:

```tsx
      {p.onToggleLogs && (
        <button
          style={btn}
          onClick={p.onToggleLogs}
          title={p.logsOpen ? "Hide logs panel" : "Show logs panel"}
        >
          {p.logsOpen ? "▾ Hide logs" : "▴ Show logs"}
          {typeof p.logsCount === "number" && p.logsCount > 0 && (
            <span style={{ marginLeft: 6, color: "#888", fontSize: 11 }}>
              ({p.logsCount})
            </span>
          )}
        </button>
      )}
```

No other changes to this file.

---

## Task 5: Build `WorkflowLogsPanel`

**Files:**
- Create: `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx`

- [ ] **Step 1: Create the file**

Create `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx`:

```tsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkflowInstanceEvent, WorkflowNode } from "@journeyman/core";
import { parseLogs } from "./parse-logs.ts";
import {
  ALL_KINDS,
  KIND_COLOR,
  KIND_LABEL,
  type LogKind,
  type ParsedLog,
} from "./types.ts";

export interface WorkflowLogsPanelProps {
  events: WorkflowInstanceEvent[];
  nodes: WorkflowNode[];
  height: number;
  onResizeHeight: (next: number) => void;
  onClose: () => void;
}

const NEAR_BOTTOM_THRESHOLD = 24;

function fmtTime(d: Date): string {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleTimeString(undefined, { hour12: false });
}

export function WorkflowLogsPanel(props: WorkflowLogsPanelProps) {
  const allLogs: ParsedLog[] = useMemo(
    () => parseLogs(props.events, props.nodes),
    [props.events, props.nodes],
  );

  // ----- Filter state -----
  const [activeKinds, setActiveKinds] = useState<Record<LogKind, boolean>>({
    assistant: true, tool: true, tool_result: true,
    result_ok: true, result_err: true, other: true,
  });
  const [activePhases, setActivePhases] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  // ----- Derive phase chip list (phases that produced ≥1 log) -----
  const phaseChips = useMemo(() => {
    const seen = new Map<string, string>(); // nodeId → phaseName
    for (const l of allLogs) {
      if (l.nodeId && !seen.has(l.nodeId)) seen.set(l.nodeId, l.phaseName);
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [allLogs]);

  // ----- Apply filters -----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allLogs.filter(l => {
      if (!activeKinds[l.kind]) return false;
      if (activePhases.size > 0) {
        if (!l.nodeId || !activePhases.has(l.nodeId)) return false;
      }
      if (q && !l.line.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allLogs, activeKinds, activePhases, search]);

  // ----- Kind counts (over unfiltered logs) -----
  const kindCounts = useMemo(() => {
    const c: Partial<Record<LogKind, number>> = {};
    for (const l of allLogs) c[l.kind] = (c[l.kind] ?? 0) + 1;
    return c;
  }, [allLogs]);

  // ----- Auto-scroll -----
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const wasNearBottomRef = useRef<boolean>(true);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasNearBottomRef.current = distance <= NEAR_BOTTOM_THRESHOLD;
  }, [filtered.length]);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (autoScroll && wasNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  // ----- Vertical drag handle (top edge) -----
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dy = ev.clientY - dragRef.current.startY;
      // Dragging up (negative dy) should grow the panel.
      props.onResizeHeight(dragRef.current.startHeight - dy);
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [props.onResizeHeight]);

  const onHandleMouseDown = (ev: React.MouseEvent) => {
    dragRef.current = { startY: ev.clientY, startHeight: props.height };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  // ----- Handlers -----
  const toggleKind = (k: LogKind) =>
    setActiveKinds(prev => ({ ...prev, [k]: !prev[k] }));

  const togglePhase = (nodeId: string) =>
    setActivePhases(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });

  const clearPhases = () => setActivePhases(new Set());

  const toggleExpand = (id: number) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const scrollToTop = () => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  };
  const scrollToBottom = () => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  };

  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const copyAll = async () => {
    const text = filtered
      .map(l => {
        const head = `[${fmtTime(l.ts)}] [${l.phaseName}] ${l.line}`;
        const sub = l.meta && Object.keys(l.meta).length > 0
          ? `\n${JSON.stringify(l.meta, null, 2)}`
          : "";
        return head + sub;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1500);
  };

  return (
    <div className="je-runview__logspanel" style={{ height: props.height }}>
      <div
        className="je-runview__logspanel-handle"
        onMouseDown={onHandleMouseDown}
        title="Drag to resize"
      >
        <span /><span /><span />
      </div>

      <div className="je-runview__logspanel-header">
        <h3 style={{ margin: 0 }}>
          Logs ({filtered.length}{filtered.length !== allLogs.length ? ` / ${allLogs.length}` : ""})
        </h3>
        <input
          type="text"
          className="je-runview__logspanel-search"
          placeholder="Filter logs…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="je-runview__log-actions">
          <label className="je-runview__log-autoscroll" title="Auto-scroll to follow new logs">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <button type="button" className="je-runview__log-scrollbtn" onClick={scrollToTop} title="Scroll to top">↑ Top</button>
          <button type="button" className="je-runview__log-scrollbtn" onClick={scrollToBottom} title="Scroll to bottom">↓ Bottom</button>
          <button
            type="button"
            className="je-runview__log-scrollbtn"
            onClick={copyAll}
            disabled={filtered.length === 0}
            title="Copy all visible logs"
          >
            {copyState === "copied" ? "✓ Copied" : copyState === "error" ? "Copy failed" : "⧉ Copy"}
          </button>
          <button
            type="button"
            className="je-runview__log-scrollbtn"
            onClick={props.onClose}
            title="Close logs panel"
          >✕</button>
        </div>
      </div>

      {allLogs.length > 0 && (
        <div className="je-runview__log-filters">
          {ALL_KINDS.map(k => {
            const n = kindCounts[k] ?? 0;
            if (n === 0) return null;
            const on = activeKinds[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleKind(k)}
                className={`je-runview__log-chip${on ? " je-runview__log-chip--on" : ""}`}
                style={{
                  borderColor: KIND_COLOR[k],
                  color: on ? "#1a1a24" : KIND_COLOR[k],
                  background: on ? KIND_COLOR[k] : "transparent",
                }}
                title={`Toggle ${KIND_LABEL[k]}`}
              >
                {KIND_LABEL[k]} ({n})
              </button>
            );
          })}
        </div>
      )}

      {phaseChips.length > 0 && (
        <div className="je-runview__log-filters">
          <button
            type="button"
            onClick={clearPhases}
            className={`je-runview__log-chip${activePhases.size === 0 ? " je-runview__log-chip--on" : ""}`}
            style={{ borderColor: "#888", color: activePhases.size === 0 ? "#1a1a24" : "#aaa", background: activePhases.size === 0 ? "#888" : "transparent" }}
            title="Show all phases"
          >All phases</button>
          {phaseChips.map(p => {
            const on = activePhases.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePhase(p.id)}
                className={`je-runview__log-chip${on ? " je-runview__log-chip--on" : ""}`}
                style={{
                  borderColor: "#7d8aff",
                  color: on ? "#1a1a24" : "#7d8aff",
                  background: on ? "#7d8aff" : "transparent",
                }}
                title={`Toggle phase ${p.name}`}
              >{p.name}</button>
            );
          })}
        </div>
      )}

      <div ref={scrollerRef} className="je-runview__log je-runview__logspanel-list">
        {allLogs.length === 0 && <div style={{ color: "#666" }}>(no logs yet)</div>}
        {allLogs.length > 0 && filtered.length === 0 && (
          <div style={{ color: "#666" }}>(all filters hide every log)</div>
        )}
        {filtered.map(l => {
          const isExpanded = expanded.has(l.id);
          const hasMeta = l.meta && Object.keys(l.meta).length > 0;
          return (
            <div key={l.id} className="je-runview__log-entry">
              <div
                className="je-runview__log-line"
                onClick={hasMeta ? () => toggleExpand(l.id) : undefined}
                style={{
                  cursor: hasMeta ? "pointer" : "default",
                  color: KIND_COLOR[l.kind],
                }}
                title={hasMeta ? "Click to expand event payload" : undefined}
              >
                <span className="je-runview__log-time">{fmtTime(l.ts)}</span>
                <span
                  className="je-runview__log-phase"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (l.nodeId) setActivePhases(new Set([l.nodeId]));
                  }}
                  title={l.nodeId ? `Filter to phase: ${l.phaseName}` : undefined}
                  style={{ cursor: l.nodeId ? "pointer" : "default" }}
                >{l.phaseName}</span>
                {hasMeta && (
                  <span className="je-runview__log-caret">{isExpanded ? "▾" : "▸"}</span>
                )}
                <span>{l.line}</span>
              </div>
              {isExpanded && hasMeta && (
                <pre className="je-runview__log-meta">{JSON.stringify(l.meta, null, 2)}</pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

---

## Task 6: Verify `WorkflowNode` and `events`/`nodes` types resolve correctly

**Files:**
- Read-only check: `packages/core/src/index.ts`, `packages/run-viewer/src/types.ts`

- [ ] **Step 1: Grep for the node type**

Run: `grep -n "WorkflowNode\b" packages/core/src/index.ts packages/core/src/types/*.ts packages/run-viewer/src/types.ts`

Expected: at least one export of `WorkflowNode` (or equivalent) from `@journeyman/core`, plus a reference to it on the `workflow` prop used by `WorkflowInstanceViewerProps`.

- [ ] **Step 2: If the type is named differently, fix imports**

If the type is exported under a different name (e.g. `FlowNode`, `WorkflowNodeDefinition`):

- In `packages/run-viewer/src/logs/parse-logs.ts`: change `import type { WorkflowInstanceEvent, WorkflowNode } from "@journeyman/core";` to import the correct name, and change every `WorkflowNode` occurrence in the signature/body.
- In `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx`: change the same import.

If the type IS named `WorkflowNode` and IS exported, no changes are needed.

- [ ] **Step 3: Verify field names on the node type**

Run: `grep -n "displayName\|phaseType" packages/core/src/types/*.ts | head`

Confirm that the fields used in `buildNameMap` (`displayName`, `phaseType`, `type`, `id`) actually exist on the node type. If any field is named differently, update `buildNameMap` in `parse-logs.ts` to match. The fallback chain must mirror the one in `RunViewer.tsx:35` (`selectedNode?.displayName ?? selectedNode?.phaseType ?? selectedNode?.type`).

---

## Task 7: Add CSS for the bottom panel

**Files:**
- Modify: `packages/run-viewer/src/styles.css`

- [ ] **Step 1: Ensure outer container stacks correctly**

Find the rule for `.je-runview` in `packages/run-viewer/src/styles.css`. It is currently a block container holding the topbar and the body. The body uses `min-height: 0` already. We need the outer `.je-runview` to be a flex column so the bottom panel takes its requested height and the body shrinks to fit.

Edit the existing `.je-runview` rule (whatever it currently looks like — likely something like `.je-runview { display: flex; flex-direction: column; ... }`) to ensure these properties are present (add the missing ones; do not delete unrelated declarations):

```css
.je-runview {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
```

Edit `.je-runview__body` so it grows to fill remaining vertical space:

```css
.je-runview__body {
  display: grid;
  grid-template-columns: 1fr 6px 360px;
  min-height: 0;
  flex: 1 1 auto;
}
```

(Keep the existing `grid-template-columns` value — it's overridden inline anyway.)

- [ ] **Step 2: Append new styles for the panel**

Append to the bottom of `packages/run-viewer/src/styles.css`:

```css
.je-runview__logspanel {
  display: flex;
  flex-direction: column;
  background: #11111a;
  border-top: 1px solid #2a2a3a;
  min-height: 0;
}

.je-runview__logspanel-handle {
  height: 6px;
  cursor: row-resize;
  background: transparent;
  border-top: 1px solid #2a2a3a;
  border-bottom: 1px solid #2a2a3a;
  position: relative;
  flex: 0 0 6px;
}
.je-runview__logspanel-handle > span {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 2px;
  background: #666;
  border-radius: 1px;
  transform: translate(-50%, -50%);
}
.je-runview__logspanel-handle > span:nth-child(1) { margin-left: -8px; }
.je-runview__logspanel-handle > span:nth-child(3) { margin-left: 8px; }

.je-runview__logspanel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid #2a2a3a;
}
.je-runview__logspanel-header h3 {
  margin: 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #aaa;
}
.je-runview__logspanel-search {
  flex: 1;
  max-width: 320px;
  background: #1a1a2a;
  border: 1px solid #2a2a3a;
  color: #ddd;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-family: inherit;
}
.je-runview__logspanel-search::placeholder { color: #666; }

.je-runview__logspanel-list {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
  margin: 0;
  border: none;
  border-radius: 0;
  padding: 8px 10px;
}

.je-runview__log-phase {
  display: inline-block;
  padding: 0 6px;
  border-radius: 8px;
  background: rgba(125, 138, 255, 0.15);
  color: #aab2ff;
  font-size: 10px;
  flex-shrink: 0;
}
```

Note: `.je-runview__logspanel-list` overrides the `.je-runview__log` `max-height: 320px` so the list fills the panel.

---

## Task 8: Manual smoke verification in the browser

**Files:**
- None (verification only)

- [ ] **Step 1: Start the dev server**

Identify which app embeds `WorkflowInstanceViewer`. Run: `grep -rln "WorkflowInstanceViewer\|@journeyman/run-viewer" packages/web/src apps 2>/dev/null | head`. Start the corresponding dev server (e.g. `npm run dev -w @journeyman/web` or whatever script the consuming app uses).

If there is no consuming app available, skip this task and state so when reporting completion.

- [ ] **Step 2: Verify the toggle and panel**

Open a workflow instance with at least one phase that has produced logs. Confirm:

- "▴ Show logs" button appears in the topbar with a count.
- Clicking it opens the bottom panel; clicking again closes it.
- Dragging the top edge of the panel resizes its height; release commits the height. Reloading the page restores the height and open state.
- Kind chips toggle visibility; phase chips toggle phase filtering; "All phases" clears the phase filter.
- Search box substring-filters the visible lines.
- Clicking a phase pill on a row sets the phase filter to just that phase.
- Clicking a row with meta expands the JSON; clicking again collapses.
- Auto-scroll sticks to the bottom while near the bottom.
- The existing right-drawer phase logs view continues to work for the selected phase (no regression).

---

## Task 9: Typecheck

**Files:**
- None (verification only)

- [ ] **Step 1: Run the workspace typecheck**

From the repo root:

```bash
npm run typecheck
```

Expected: exit code 0 with no TypeScript errors in `@journeyman/run-viewer`, `@journeyman/core`, or any package that consumes the run viewer. If errors appear, fix them in the relevant file from the file map above and rerun until clean.

---

## Notes for the implementer

- **No commits.** Leave changes in the working tree dirty for the user to review.
- **No unit tests.** Do not create `*.test.ts` files for any of the new code; rely on the manual smoke step and typecheck.
- **Do not modify** `packages/flow-editor/src/canvas/PanelResizer.tsx` — its API is `width`/`onResize` along the horizontal axis only. The bottom panel inlines its own vertical drag handle (Task 5).
- Keep existing log colors and kind labels identical between `PhaseLogsSection` and `WorkflowLogsPanel` by sourcing them from `logs/types.ts`.
- All log entries in both views read from `props.events`, so the two panels remain naturally in sync without explicit wiring.
