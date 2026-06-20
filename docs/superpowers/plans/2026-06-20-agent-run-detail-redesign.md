# Agent Run Detail Page — Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the narrow 860px-centered `AgentRunDetailPage` with a full-bleed tabbed layout (Details / Logs / Tokens & Cost) matching the `AgentDetail` page pattern.

**Architecture:** Three tasks in sequence: (1) make `WorkflowLogsPanel`'s `height`/`onResizeHeight` props optional so the logs tab can own its own vertical space, (2) create the `RunSectionNav` component, (3) rewrite `AgentRunDetailPage` using the new nav and inline panel components. No backend changes. No commits.

**Tech Stack:** React 18, Tailwind CSS v4, TypeScript. All changes in `packages/web` and `packages/run-viewer`.

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx` | Make `height` and `onResizeHeight` optional; suppress handle + fixed height when omitted |
| Create | `packages/web/src/components/agents/sections/RunSectionNav.tsx` | Vertical sidebar nav for run detail page (Details / Logs / Tokens & Cost) |
| Modify | `packages/web/src/routes/AgentRunDetailPage.tsx` | Full rewrite: full-bleed layout, tabbed card, inline panel components, Tailwind classes |

---

## Task 1: Make `height` and `onResizeHeight` optional in `WorkflowLogsPanel`

**Files:**
- Modify: `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx`

The component currently requires `height: number` and `onResizeHeight: (next: number) => void`. When `height` is omitted the panel should have no fixed height (letting CSS control it). When either is omitted the drag handle must not render.

- [ ] **Step 1: Update the props interface**

In `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx`, change lines 13–27:

```typescript
export interface WorkflowLogsPanelProps {
  events: WorkflowInstanceEvent[];
  nodes: WorkflowNode[];
  /** When omitted the panel has no fixed height (CSS controls it) and the drag handle is hidden. */
  height?: number;
  /** Required when `height` is provided; omit together with `height` for tab-owned layouts. */
  onResizeHeight?: (next: number) => void;
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

- [ ] **Step 2: Guard the drag listeners on `onResizeHeight`**

The `useEffect` at line ~94 calls `props.onResizeHeight(next)` unconditionally. Guard it:

```typescript
useEffect(() => {
  const onMove = (ev: MouseEvent) => {
    if (!dragRef.current || !props.onResizeHeight) return;
    const dy = ev.clientY - dragRef.current.startY;
    const next = props.resizeEdge === 'bottom'
      ? dragRef.current.startHeight + dy
      : dragRef.current.startHeight - dy;
    props.onResizeHeight(next);
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
}, [props.onResizeHeight, props.resizeEdge]);
```

- [ ] **Step 3: Guard `onHandleMouseDown` and hide the handle when `height` is absent**

Replace the `onHandleMouseDown` function and the JSX for `handle` and the root `<div>`:

```typescript
const onHandleMouseDown = (ev: React.MouseEvent) => {
  if (props.height == null) return;
  dragRef.current = { startY: ev.clientY, startHeight: props.height };
  document.body.style.cursor = "row-resize";
  document.body.style.userSelect = "none";
};

const handle = props.height != null ? (
  <div
    className="je-runview__logspanel-handle"
    onMouseDown={onHandleMouseDown}
    title="Drag to resize"
  >
    <span /><span /><span />
  </div>
) : null;
```

Change the root `<div>` style at line ~181:

```typescript
<div
  className="je-runview__logspanel"
  style={props.height != null ? { height: props.height } : undefined}
>
```

- [ ] **Step 4: Verify TypeScript is happy with this file**

```bash
cd packages/run-viewer && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors in `WorkflowLogsPanel.tsx`. (Other pre-existing errors in the repo are OK — check only that there are no new errors in this file.)

---

## Task 2: Create `RunSectionNav`

**Files:**
- Create: `packages/web/src/components/agents/sections/RunSectionNav.tsx`

Mirrors `SectionNav.tsx` exactly — same Tailwind classes, same active/hover states — but for the three run detail sections.

- [ ] **Step 1: Write the file**

```typescript
export type RunSectionId = "details" | "logs" | "tokens";

const RUN_SECTIONS: Array<{ id: RunSectionId; label: string; icon: string }> = [
  { id: "details", label: "Details",        icon: "📋" },
  { id: "logs",    label: "Logs",           icon: "📜" },
  { id: "tokens",  label: "Tokens & Cost",  icon: "🪙" },
];

export function RunSectionNav({
  active,
  onSelect,
}: {
  active: RunSectionId;
  onSelect: (id: RunSectionId) => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5">
      {RUN_SECTIONS.map((s) => {
        const isActive = active === s.id;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={[
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-left transition w-full",
              isActive
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            ].join(" ")}
          >
            <span className="w-4 text-center opacity-80">{s.icon}</span>
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Verify TypeScript is happy**

```bash
cd packages/web && npx tsc --noEmit 2>&1 | grep "RunSectionNav" | head -10
```

Expected: no output (no errors referencing the new file).

---

## Task 3: Rewrite `AgentRunDetailPage`

**Files:**
- Modify: `packages/web/src/routes/AgentRunDetailPage.tsx`

Full replacement. Data fetching, `StatusPill`, `fmtRelative`, and `allEvents` memo are kept identical. All inline styles become Tailwind classes. `logHeight` state is removed. A `section` state drives the tab. Three inline panel components replace the old stat strip + detail rows + log panel.

- [ ] **Step 1: Replace the entire file**

```typescript
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { agentsApi } from "../api/agents.ts";
import { getRun, openWorkflowInstanceEventStream } from "../api/runs.ts";
import type { WorkflowInstanceDetail } from "../api/runs.ts";
import type { Agent } from "@journeyman/core";
import type { WorkflowInstanceEvent } from "@journeyman/core";
import { formatDuration, isTerminalStatus } from "@journeyman/core";
import { WorkflowLogsPanel } from "@journeyman/run-viewer";
import { btnSecondary, card } from "./admin-styles.ts";
import { RunSectionNav, type RunSectionId } from "../components/agents/sections/RunSectionNav.tsx";

// ── Status pill ────────────────────────────────────────────────────────────────

const PILL_CLS: Record<string, string> = {
  running:   "bg-blue-500/15 text-blue-400",
  completed: "bg-emerald-500/15 text-emerald-400",
  failed:    "bg-red-500/15 text-red-400",
  cancelled: "bg-zinc-500/15 text-zinc-400",
  paused:    "bg-amber-500/15 text-amber-400",
};

function StatusPill({ status }: { status: string }) {
  const cls = PILL_CLS[status] ?? PILL_CLS.cancelled;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] px-2.5 py-0.5 rounded-full font-semibold ${cls}`}>
      {status === "running" && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0 animate-pulse" />
      )}
      {status}
    </span>
  );
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function fmtRelative(d: Date | string | null): string {
  if (!d) return "—";
  const diff = Date.now() - (d instanceof Date ? d : new Date(d)).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return "just now";
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h} hr ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Panel: Details ─────────────────────────────────────────────────────────────

function RunDetailsPanel({
  wi,
  provider,
  model,
  isRunning,
  repoName,
  prUrl,
  prNumber,
  displayInputs,
  outputText,
}: {
  wi: WorkflowInstanceDetail["workflowInstance"];
  provider: string;
  model: string | undefined;
  isRunning: boolean;
  repoName: string | undefined;
  prUrl: string | undefined;
  prNumber: number | undefined;
  displayInputs: Record<string, unknown>;
  outputText: string | undefined;
}) {
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Trigger",  value: wi.triggerSource },
    { label: "Duration", value: isRunning ? "running…" : formatDuration(wi.durationMs) },
    { label: "Model",    value: `${provider}${model ? ` · ${model}` : ""}` },
    ...(repoName ? [{
      label: "Repository",
      value: (
        <>
          {repoName}
          {prUrl && prNumber != null && (
            <> <span className="text-muted-foreground">→</span>{" "}
              <a href={prUrl} target="_blank" rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground">
                PR #{prNumber}
              </a>
            </>
          )}
        </>
      ),
    }] : []),
    ...(Object.keys(displayInputs).length > 0 ? [{
      label: "Inputs",
      value: (
        <code className="block text-[13px] font-mono text-muted-foreground bg-muted/50 border rounded px-2.5 py-1.5 break-all whitespace-pre-wrap">
          {JSON.stringify(displayInputs)}
        </code>
      ),
    }] : []),
    ...(outputText ? [{ label: "Output", value: outputText }] : []),
  ];

  return (
    <div className="grid grid-cols-[130px_1fr] gap-x-6 gap-y-3.5 text-sm">
      {rows.map(({ label, value }) => (
        <Fragment key={label}>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground pt-0.5">
            {label}
          </div>
          <div>{value}</div>
        </Fragment>
      ))}
    </div>
  );
}

// ── Panel: Logs ────────────────────────────────────────────────────────────────

function RunLogsPanel({ events }: { events: WorkflowInstanceEvent[] }) {
  return (
    <WorkflowLogsPanel
      events={events}
      nodes={[]}
      onClose={() => {}}
      hideStepChips
    />
  );
}

// ── Panel: Tokens & Cost ───────────────────────────────────────────────────────

function RunTokensPanel() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] gap-3 text-muted-foreground">
      <span className="text-3xl">🪙</span>
      <p className="text-sm font-semibold text-foreground/70">Token usage &amp; cost tracking coming soon</p>
      <p className="text-xs text-center max-w-[280px] leading-relaxed">
        Once token tracking is wired up in the backend, you'll see input tokens,
        output tokens, and estimated cost per run here.
      </p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function AgentRunDetailPage() {
  const { wsId = "", runId = "" } = useParams<{ wsId: string; runId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<WorkflowInstanceDetail | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [liveEvents, setLiveEvents] = useState<WorkflowInstanceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<RunSectionId>("details");

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    getRun(wsId, runId)
      .then(d => {
        setDetail(d);
        const agentId = d.workflowInstance.inputs["agentId"] as string | undefined;
        if (agentId) {
          agentsApi.get(wsId, agentId).then(setAgent).catch(() => null);
        }
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [wsId, runId]);

  useEffect(() => {
    if (!detail || isTerminalStatus(detail.workflowInstance.status)) return;
    const lastId = detail.events.at(-1)?.id ?? 0;
    return openWorkflowInstanceEventStream({
      wsId, runId, sinceId: lastId,
      onEvent: ev => setLiveEvents(prev => [...prev, ev]),
    });
  }, [detail, wsId, runId]);

  const allEvents = useMemo(() => {
    const byId = new Map<number, WorkflowInstanceEvent>();
    for (const e of detail?.events ?? []) byId.set(e.id, e);
    for (const e of liveEvents) byId.set(e.id, e);
    return Array.from(byId.values()).sort((a, b) => a.id - b.id);
  }, [detail?.events, liveEvents]);

  if (!runId) { navigate(`/workspaces/${wsId}/agent-runs`); return null; }
  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (error || !detail) return <div className="p-6 text-sm text-destructive">{error ?? "Run not found."}</div>;

  const wi = detail.workflowInstance;
  const agentName   = agent?.name     ?? (wi.inputs["agentId"] as string | undefined) ?? "Agent";
  const provider    = agent?.provider ?? "claude";
  const model       = agent?.model;
  const isRunning   = !isTerminalStatus(wi.status);

  const displayInputs = { ...wi.inputs };
  delete displayInputs["agentId"];

  const prUrl     = wi.outputs?.["prUrl"]    as string | undefined;
  const prNumber  = wi.outputs?.["prNumber"] as number | undefined;
  const repoName  = (wi.inputs["repo"] ?? wi.inputs["repository"]) as string | undefined;
  const outputText = (wi.outputs?.["result"] ?? wi.outputs?.["summary"]) as string | undefined;

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Sticky header */}
      <header className="shrink-0 border-b bg-background px-6 pt-5 pb-4">
        <div className="text-xs text-muted-foreground mb-1.5">
          <Link
            to={`/workspaces/${wsId}/agent-runs`}
            className="hover:text-foreground transition-colors"
          >
            Agent Runs
          </Link>
          <span className="mx-1.5">/</span>
          {agentName}
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{agentName}</h1>
              <StatusPill status={wi.status} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground font-mono">
              {wi.id.slice(0, 8)}&nbsp;·&nbsp;{fmtRelative(wi.startedAt)}
            </p>
          </div>
          <a
            href={`/workspaces/${wsId}/workflow-instances/${wi.id}`}
            className={`${btnSecondary} no-underline`}
          >
            Open workflow instance →
          </a>
        </div>
      </header>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        <div className={`${card} overflow-hidden`}>
          <div className="flex min-h-[500px]">

            {/* Sidebar nav */}
            <aside className="w-44 shrink-0 border-r p-3">
              <RunSectionNav active={section} onSelect={setSection} />
            </aside>

            {/* Content panel */}
            <div className="flex-1 p-6">
              {section === "details" && (
                <RunDetailsPanel
                  wi={wi}
                  provider={provider}
                  model={model}
                  isRunning={isRunning}
                  repoName={repoName}
                  prUrl={prUrl}
                  prNumber={prNumber}
                  displayInputs={displayInputs}
                  outputText={outputText}
                />
              )}
              {section === "logs" && <RunLogsPanel events={allEvents} />}
              {section === "tokens" && <RunTokensPanel />}
            </div>

          </div>
        </div>
      </div>

    </div>
  );
}
```

- [ ] **Step 2: Verify the import of `WorkflowInstanceDetail` is still satisfied**

`WorkflowInstanceDetail` is imported from `"../api/runs.ts"` in the new file. Confirm the type is used correctly — `wi` is typed as `WorkflowInstanceDetail["workflowInstance"]` in `RunDetailsPanel`'s props. Check the actual shape:

```bash
grep -n "WorkflowInstanceDetail\|workflowInstance" packages/web/src/api/runs.ts | head -10
```

If `workflowInstance` is not a key on `WorkflowInstanceDetail`, adjust the prop type to use the actual key name. For example, if the property is named `instance`, change:

```typescript
wi: WorkflowInstanceDetail["workflowInstance"];
```
to:
```typescript
wi: WorkflowInstanceDetail["instance"];
```

---

## Task 4: Typecheck

- [ ] **Step 1: Run full typecheck from the repo root**

```bash
npm run typecheck 2>&1
```

Expected: no new errors. Pre-existing errors (if any) from unrelated files are acceptable — look specifically for errors in:
- `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx`
- `packages/web/src/components/agents/sections/RunSectionNav.tsx`
- `packages/web/src/routes/AgentRunDetailPage.tsx`

- [ ] **Step 2: If there are errors, fix them**

Common fixes:

**`WorkflowInstanceDetail["workflowInstance"]` does not exist** → Run the grep from Task 3 Step 2 to find the correct key name and update the `RunDetailsPanel` prop type.

**`onClose` prop missing on `WorkflowLogsPanel`** → `onClose` is still required; confirm it's passed as `onClose={() => {}}` in `RunLogsPanel`.

**`height` still required** → Check that Task 1 Step 1 was applied and `height?:` (with `?`) is in the interface.

**Tailwind class not found** → Tailwind v4 uses CSS-variable-based utilities; class names like `bg-accent`, `text-muted-foreground` are theme tokens wired in `packages/web/src/styles.css`. These are fine — Tailwind v4 does not tree-shake unknown class names at typecheck time.
