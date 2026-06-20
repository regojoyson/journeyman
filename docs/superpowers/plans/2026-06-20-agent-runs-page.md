# Agent Runs Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a workspace-wide Agent Runs list page and per-run detail page with a live log panel, reusing the existing `WorkflowLogsPanel` design.

**Architecture:** A new backend endpoint (`GET /api/workspaces/:wsId/agent-runs`) queries `jm_workflow_instances` joined with `jm_agents` for enriched run data. The frontend adds two new route pages; the detail page fetches the run detail from the existing `getRun` endpoint and separately fetches the agent to get provider/model, then renders `WorkflowLogsPanel` (with step chips hidden). SSE via the existing `openWorkflowInstanceEventStream` drives live log updates.

**Tech Stack:** React, React Router, `@tanstack/react-query` (for list page), `pg` SQL, Fastify, `@journeyman/run-viewer` (`WorkflowLogsPanel`), `@journeyman/core` (`formatDuration`, `isTerminalStatus`).

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx` | Modify | Add `hideStepChips?: boolean` prop |
| `packages/run-viewer/src/index.ts` | Modify | Export `WorkflowLogsPanel`, `WorkflowLogsPanelProps`, `parseLogs` |
| `packages/api-server/src/routes/agents.ts` | Modify | Add `GET /api/workspaces/:wsId/agent-runs` endpoint |
| `packages/web/src/api/agents.ts` | Modify | Add `AgentRunEnriched` type + `listAgentRuns()` API fn |
| `packages/web/src/components/nav-config.ts` | Modify | Add "Agent Runs" sidebar entry |
| `packages/web/src/components/agents/AgentRunsList.tsx` | Create | Table + filters component |
| `packages/web/src/routes/AgentRunsPage.tsx` | Create | List page route component |
| `packages/web/src/routes/AgentRunDetailPage.tsx` | Create | Detail page route component |
| `packages/web/src/App.tsx` | Modify | Wire two new routes |
| `packages/web/src/components/agents/sections/RunHistorySection.tsx` | Modify | Update links to `/agent-runs/:id` |

---

## Task 1: Export `WorkflowLogsPanel` and `parseLogs` from `@journeyman/run-viewer`

**Files:**
- Modify: `packages/run-viewer/src/index.ts`

The detail page needs to render `WorkflowLogsPanel` standalone (without the full canvas viewer). It is currently only used internally. We also need `parseLogs` to convert events → `ParsedLog[]`, and the `WorkflowLogsPanelProps` type.

- [ ] **Step 1: Add exports to `packages/run-viewer/src/index.ts`**

Open the file; it currently exports only `WorkflowInstanceViewer` and related types. Add:

```typescript
export { WorkflowLogsPanel } from "./logs/WorkflowLogsPanel.tsx";
export type { WorkflowLogsPanelProps } from "./logs/WorkflowLogsPanel.tsx";
export { parseLogs } from "./logs/parse-logs.ts";
export type { ParsedLog, LogKind } from "./logs/types.ts";
```

The file should look like:

```typescript
export { WorkflowInstanceViewer } from "./RunViewer.tsx";
export { computeNodeStatuses } from "./status/compute-node-status.ts";
export type { WorkflowInstanceViewerProps, NodeStatus, ResolvedNodeStatus, PendingHumanTask, HumanTaskHistoryEntry } from "./types.ts";
export { WorkflowLogsPanel } from "./logs/WorkflowLogsPanel.tsx";
export type { WorkflowLogsPanelProps } from "./logs/WorkflowLogsPanel.tsx";
export { parseLogs } from "./logs/parse-logs.ts";
export type { ParsedLog, LogKind } from "./logs/types.ts";
```

---

## Task 2: Add `hideStepChips` prop to `WorkflowLogsPanel`

**Files:**
- Modify: `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx`

Agent runs have exactly one workflow node (the custom-AI step), so the step-chips row would show a single chip that does nothing useful. Add `hideStepChips?: boolean` to suppress it.

- [ ] **Step 1: Add prop to the interface**

In `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx`, find:

```typescript
export interface WorkflowLogsPanelProps {
  events: WorkflowInstanceEvent[];
  nodes: WorkflowNode[];
  height: number;
  onResizeHeight: (next: number) => void;
  onClose: () => void;
}
```

Change to:

```typescript
export interface WorkflowLogsPanelProps {
  events: WorkflowInstanceEvent[];
  nodes: WorkflowNode[];
  height: number;
  onResizeHeight: (next: number) => void;
  onClose: () => void;
  /** When true, the step-chips filter row is not rendered (use for single-step runs). */
  hideStepChips?: boolean;
}
```

- [ ] **Step 2: Thread the prop into the component**

In `WorkflowLogsPanel`, find the destructure at the top of the function body (currently `const { ... } = props` or inline `props.events` etc). Add `hideStepChips` to wherever `props` is used.

Find this block (the step-chips row, which is the second filter block):

```tsx
      {stepChips.length > 0 && (
        <div className="je-runview__log-filters">
          <button
            type="button"
            onClick={clearSteps}
```

Wrap the entire `stepChips.length > 0` block with `!props.hideStepChips &&`:

```tsx
      {!props.hideStepChips && stepChips.length > 0 && (
        <div className="je-runview__log-filters">
          <button
            type="button"
            onClick={clearSteps}
```

---

## Task 3: Backend — workspace-wide agent runs endpoint

**Files:**
- Modify: `packages/api-server/src/routes/agents.ts`

Add `GET /api/workspaces/:wsId/agent-runs` — paginated list of all agent runs in the workspace, joined with agent name/provider/model.

Key schema facts (from existing code):
- `jm_workflow_instances`: `id`, `workspace_id`, `status`, `trigger_source`, `started_at`, `completed_at`, `duration_ms`, `inputs` (JSONB — `agentId` stored at `inputs->>'agentId'`), `outputs` (JSONB)
- `jm_agents`: `id`, `name`, `definition` (JSONB — `provider` at `definition->>'provider'`, `model` at `definition->>'model'`)

- [ ] **Step 1: Add the endpoint at the end of `registerAgentRoutes`**

Open `packages/api-server/src/routes/agents.ts`. Before the closing `}` of `registerAgentRoutes`, add:

```typescript
  // Workspace-wide agent runs — all runs across all agents in this workspace.
  app.get("/api/workspaces/:wsId/agent-runs", read, async (req, reply) => {
    const { wsId } = req.params as { wsId: string };
    const q = req.query as {
      status?: string;
      agentId?: string;
      trigger?: string;
      page?: string;
      pageSize?: string;
    };

    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20) || 20));
    const offset = (page - 1) * pageSize;

    const conds: string[] = ["wi.workspace_id = $1", "wi.inputs->>'agentId' IS NOT NULL"];
    const params: unknown[] = [wsId];
    const next = () => { params.push(undefined as any); return `$${params.length}`; };

    if (q.status) {
      params[params.length] = q.status;
      conds.push(`wi.status = $${params.push(q.status)}`);
    }
    if (q.agentId) {
      conds.push(`wi.inputs->>'agentId' = $${params.push(q.agentId)}`);
    }
    if (q.trigger) {
      conds.push(`wi.trigger_source = $${params.push(q.trigger)}`);
    }

    const where = conds.join(" AND ");

    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT
           wi.id,
           wi.status,
           wi.trigger_source,
           wi.started_at,
           wi.completed_at,
           wi.duration_ms,
           wi.inputs,
           wi.outputs,
           a.id         AS agent_id,
           a.name       AS agent_name,
           a.definition->>'provider' AS provider,
           a.definition->>'model'    AS model
         FROM jm_workflow_instances wi
         LEFT JOIN jm_agents a ON a.id = (wi.inputs->>'agentId')
         WHERE ${where}
         ORDER BY wi.started_at DESC NULLS LAST
         LIMIT ${pageSize} OFFSET ${offset}`,
        params,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n
         FROM jm_workflow_instances wi
         WHERE ${where}`,
        params,
      ),
    ]);

    return {
      runs: dataRes.rows.map(r => ({
        id: r.id,
        status: r.status,
        triggerSource: r.trigger_source,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        durationMs: r.duration_ms,
        inputs: r.inputs,
        outputs: r.outputs,
        agentId: r.agent_id,
        agentName: r.agent_name ?? "Unknown",
        provider: r.provider ?? "claude",
        model: r.model ?? null,
      })),
      total: countRes.rows[0]?.n ?? 0,
      page,
      pageSize,
    };
  });
```

**Note:** The `params.push()` return value is the new length, which equals the placeholder index. Simplify by building params array first:

```typescript
  app.get("/api/workspaces/:wsId/agent-runs", read, async (req, reply) => {
    const { wsId } = req.params as { wsId: string };
    const q = req.query as {
      status?: string;
      agentId?: string;
      trigger?: string;
      page?: string;
      pageSize?: string;
    };

    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20) || 20));
    const offset = (page - 1) * pageSize;

    const conds: string[] = ["wi.workspace_id = $1", "wi.inputs->>'agentId' IS NOT NULL"];
    const params: unknown[] = [wsId];

    if (q.status)   { conds.push(`wi.status = $${params.push(q.status)}`); }
    if (q.agentId)  { conds.push(`wi.inputs->>'agentId' = $${params.push(q.agentId)}`); }
    if (q.trigger)  { conds.push(`wi.trigger_source = $${params.push(q.trigger)}`); }

    const where = conds.join(" AND ");

    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT
           wi.id, wi.status, wi.trigger_source,
           wi.started_at, wi.completed_at, wi.duration_ms,
           wi.inputs, wi.outputs,
           a.id          AS agent_id,
           a.name        AS agent_name,
           a.definition->>'provider' AS provider,
           a.definition->>'model'    AS model
         FROM jm_workflow_instances wi
         LEFT JOIN jm_agents a ON a.id = (wi.inputs->>'agentId')
         WHERE ${where}
         ORDER BY wi.started_at DESC NULLS LAST
         LIMIT ${pageSize} OFFSET ${offset}`,
        params,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n
         FROM jm_workflow_instances wi
         WHERE ${where}`,
        params,
      ),
    ]);

    return {
      runs: dataRes.rows.map(r => ({
        id: r.id,
        status: r.status,
        triggerSource: r.trigger_source,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        durationMs: r.duration_ms,
        inputs: r.inputs,
        outputs: r.outputs,
        agentId: r.agent_id,
        agentName: r.agent_name ?? "Unknown",
        provider: r.provider ?? "claude",
        model: r.model ?? null,
      })),
      total: countRes.rows[0]?.n ?? 0,
      page,
      pageSize,
    };
  });
```

---

## Task 4: Frontend API client — `AgentRunEnriched` type + `listAgentRuns()`

**Files:**
- Modify: `packages/web/src/api/agents.ts`

- [ ] **Step 1: Add `AgentRunEnriched` interface after `AgentRunSummary`**

In `packages/web/src/api/agents.ts`, after the existing `AgentRunSummary` interface, add:

```typescript
export interface AgentRunEnriched {
  id: string;
  status: string;
  triggerSource: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown> | null;
  agentId: string;
  agentName: string;
  provider: string;
  model: string | null;
}

export interface AgentRunsPage {
  runs: AgentRunEnriched[];
  total: number;
  page: number;
  pageSize: number;
}
```

- [ ] **Step 2: Add `listAgentRuns()` to `agentsApi`**

In the `agentsApi` object, add after `runs`:

```typescript
  listRuns: (
    wsId: string,
    opts: { status?: string; agentId?: string; trigger?: string; page?: number; pageSize?: number } = {},
  ) => {
    const q = new URLSearchParams();
    if (opts.status)   q.set("status",   opts.status);
    if (opts.agentId)  q.set("agentId",  opts.agentId);
    if (opts.trigger)  q.set("trigger",  opts.trigger);
    q.set("page",     String(opts.page     ?? 1));
    q.set("pageSize", String(opts.pageSize ?? 20));
    return fetch(`/api/workspaces/${wsId}/agent-runs?${q.toString()}`, { credentials: "include" })
      .then(jsonOrThrow<AgentRunsPage>);
  },
```

---

## Task 5: Add "Agent Runs" to sidebar nav-config

**Files:**
- Modify: `packages/web/src/components/nav-config.ts`

- [ ] **Step 1: Insert the nav item after "agents"**

In `packages/web/src/components/nav-config.ts`, find the workspace group items:

```typescript
      { slug: "agents", icon: "🤖", label: "Agents" },
      { slug: "custom-steps", icon: "🧩", label: "Custom Steps" },
```

Change to:

```typescript
      { slug: "agents", icon: "🤖", label: "Agents" },
      { slug: "agent-runs", icon: "▶", label: "Agent Runs" },
      { slug: "custom-steps", icon: "🧩", label: "Custom Steps" },
```

---

## Task 6: Create `AgentRunsList` component

**Files:**
- Create: `packages/web/src/components/agents/AgentRunsList.tsx`

This component receives paginated run data and filter state as props, renders the table and filter controls. The parent page owns the data-fetching.

- [ ] **Step 1: Create the file**

```typescript
import type { AgentRunEnriched } from "../../api/agents.ts";
import { formatDuration } from "@journeyman/core";
import { btnSecondary } from "../../routes/admin-styles.ts";

interface AgentRunsListProps {
  runs: AgentRunEnriched[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  statusFilter: string;
  agentFilter: string;
  triggerFilter: string;
  agents: Array<{ id: string; name: string }>;
  onStatusFilter: (s: string) => void;
  onAgentFilter: (id: string) => void;
  onTriggerFilter: (t: string) => void;
  onPageChange: (p: number) => void;
  onSelectRun: (id: string) => void;
  onRerun: (run: AgentRunEnriched) => void;
}

const STATUS_GROUPS = ["", "running", "failed"] as const;
const STATUS_LABELS: Record<string, string> = { "": "All", running: "Running", failed: "Failed" };

const PILL_STYLE: Record<string, React.CSSProperties> = {
  running:   { background: "rgba(74,158,255,.15)",  color: "rgb(var(--color-info) / 1)" },
  completed: { background: "rgba(16,185,129,.15)",  color: "rgb(var(--color-success) / 1)" },
  failed:    { background: "rgba(239,68,68,.15)",   color: "rgb(var(--color-danger) / 1)" },
  cancelled: { background: "rgba(161,161,170,.15)", color: "rgb(var(--color-text-muted) / 1)" },
  paused:    { background: "rgba(253,203,110,.15)", color: "rgb(var(--color-warning) / 1)" },
};

function StatusPill({ status }: { status: string }) {
  const style = PILL_STYLE[status] ?? PILL_STYLE.cancelled;
  return (
    <span style={{
      ...style,
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11, padding: "2px 8px", borderRadius: 8, fontWeight: 600,
    }}>
      {status === "running" && (
        <span style={{
          width: 5, height: 5, borderRadius: "50%",
          background: "rgb(var(--color-info) / 1)", flexShrink: 0,
          animation: "jePulse 1.4s infinite",
        }} />
      )}
      {status}
    </span>
  );
}

function fmtRelative(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)   return "just now";
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function AgentRunsList(p: AgentRunsListProps) {
  const totalPages = Math.ceil(p.total / p.pageSize);
  const from = p.total === 0 ? 0 : (p.page - 1) * p.pageSize + 1;
  const to   = Math.min(p.page * p.pageSize, p.total);

  return (
    <div style={{ padding: 24, color: "rgb(var(--color-text) / 1)", fontFamily: "system-ui, sans-serif", fontSize: 13 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Agent Runs</h2>

        {/* Scope chips */}
        <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
          {STATUS_GROUPS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => p.onStatusFilter(s)}
              style={{
                background: p.statusFilter === s ? "rgb(var(--color-accent) / 1)" : "rgb(var(--color-surface) / 1)",
                border: `1px solid ${p.statusFilter === s ? "rgb(var(--color-accent) / 1)" : "rgb(var(--color-border) / 1)"}`,
                color: p.statusFilter === s ? "rgb(var(--color-primary-foreground) / 1)" : "rgb(var(--color-text) / 1)",
                padding: "4px 12px", borderRadius: 14, fontSize: 12, fontWeight: 500,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Agent filter */}
        <select
          value={p.agentFilter}
          onChange={e => p.onAgentFilter(e.target.value)}
          style={{ background: "rgb(var(--color-surface) / 1)", border: "1px solid rgb(var(--color-border) / 1)", color: "rgb(var(--color-text) / 1)", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}
        >
          <option value="">All agents</option>
          {p.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

        {/* Trigger filter */}
        <select
          value={p.triggerFilter}
          onChange={e => p.onTriggerFilter(e.target.value)}
          style={{ background: "rgb(var(--color-surface) / 1)", border: "1px solid rgb(var(--color-border) / 1)", color: "rgb(var(--color-text) / 1)", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}
        >
          <option value="">All triggers</option>
          {["manual", "webhook", "schedule", "api"].map(t => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {p.isLoading ? (
        <div style={{ color: "rgb(var(--color-text-muted) / 1)" }}>Loading…</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgb(var(--color-border) / 1)" }}>
              {["Agent", "Status", "Trigger", "Started", "Duration", "Model", ""].map(h => (
                <th key={h} style={{ padding: "8px 6px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 500, color: "rgb(var(--color-text-muted) / 1)", textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.runs.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: "16px 6px", color: "rgb(var(--color-text-muted) / 1)" }}>No runs match the current filters.</td>
              </tr>
            )}
            {p.runs.map(r => (
              <tr
                key={r.id}
                onClick={() => p.onSelectRun(r.id)}
                style={{ borderBottom: "1px solid rgb(var(--color-border) / 1)", cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgb(var(--color-surface-hover) / 1)")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}
              >
                <td style={{ padding: "10px 6px", fontWeight: 500 }}>{r.agentName}</td>
                <td style={{ padding: "10px 6px" }}><StatusPill status={r.status} /></td>
                <td style={{ padding: "10px 6px", color: "rgb(var(--color-text-muted) / 1)" }}>{r.triggerSource}</td>
                <td style={{ padding: "10px 6px", color: "rgb(var(--color-text-muted) / 1)" }}>{fmtRelative(r.startedAt)}</td>
                <td style={{ padding: "10px 6px", color: "rgb(var(--color-text-muted) / 1)" }}>
                  {r.status === "running" ? `${formatDuration(r.startedAt ? Date.now() - new Date(r.startedAt).getTime() : null)}…` : formatDuration(r.durationMs)}
                </td>
                <td style={{ padding: "10px 6px", color: "rgb(var(--color-text-muted) / 1)", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                  {r.provider}{r.model ? ` · ${r.model}` : ""}
                </td>
                <td style={{ padding: "10px 6px" }}>
                  {r.status !== "running" && (
                    <button
                      type="button"
                      className={btnSecondary}
                      onClick={e => { e.stopPropagation(); p.onRerun(r); }}
                    >
                      Re-run
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Pagination */}
      {p.total > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 16, fontSize: 12, color: "rgb(var(--color-text-muted) / 1)" }}>
          <span>{from}–{to} of {p.total}</span>
          <button type="button" className={btnSecondary} disabled={p.page <= 1} onClick={() => p.onPageChange(p.page - 1)}>← Prev</button>
          <button type="button" className={btnSecondary} disabled={p.page >= totalPages} onClick={() => p.onPageChange(p.page + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
```

---

## Task 7: Create `AgentRunsPage`

**Files:**
- Create: `packages/web/src/routes/AgentRunsPage.tsx`

Owns data fetching. Passes everything down to `AgentRunsList`. Uses the same `useCallback`+`useEffect` pattern as `AgentsList`.

- [ ] **Step 1: Create the file**

```typescript
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { agentsApi, type AgentRunEnriched, type AgentRunsPage } from "../api/agents.ts";
import type { Agent } from "@journeyman/core";
import { AgentRunsList } from "../components/agents/AgentRunsList.tsx";

export function AgentRunsPage() {
  const { wsId = "" } = useParams<{ wsId: string }>();
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("");

  const [result, setResult] = useState<AgentRunsPage | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    try { setAgents(await agentsApi.list(wsId)); } catch { /* non-fatal */ }
  }, [wsId]);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentsApi.listRuns(wsId, {
        status:   statusFilter || undefined,
        agentId:  agentFilter  || undefined,
        trigger:  triggerFilter || undefined,
        page,
        pageSize: 20,
      });
      setResult(data);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [wsId, statusFilter, agentFilter, triggerFilter, page]);

  useEffect(() => { void loadAgents(); }, [loadAgents]);
  useEffect(() => { void loadRuns(); }, [loadRuns]);

  const handleStatusFilter = (s: string) => { setStatusFilter(s); setPage(1); };
  const handleAgentFilter  = (id: string) => { setAgentFilter(id); setPage(1); };
  const handleTriggerFilter = (t: string) => { setTriggerFilter(t); setPage(1); };

  const handleRerun = async (run: AgentRunEnriched) => {
    try {
      await agentsApi.runNow(wsId, run.agentId, run.inputs);
      void loadRuns();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  if (error) {
    return <div style={{ padding: 24, color: "rgb(var(--color-danger) / 1)" }}>{error}</div>;
  }

  return (
    <div style={{ height: "100%", overflowY: "auto" }}>
      <AgentRunsList
        runs={result?.runs ?? []}
        total={result?.total ?? 0}
        page={result?.page ?? 1}
        pageSize={result?.pageSize ?? 20}
        isLoading={loading}
        statusFilter={statusFilter}
        agentFilter={agentFilter}
        triggerFilter={triggerFilter}
        agents={agents.map(a => ({ id: a.id, name: a.name }))}
        onStatusFilter={handleStatusFilter}
        onAgentFilter={handleAgentFilter}
        onTriggerFilter={handleTriggerFilter}
        onPageChange={setPage}
        onSelectRun={id => navigate(`/workspaces/${wsId}/agent-runs/${id}`)}
        onRerun={handleRerun}
      />
    </div>
  );
}
```

---

## Task 8: Create `AgentRunDetailPage`

**Files:**
- Create: `packages/web/src/routes/AgentRunDetailPage.tsx`

Fetches run detail via existing `getRun()` + agent metadata via `agentsApi.get()`. Renders header, stat strip, detail rows, and `WorkflowLogsPanel` (with `hideStepChips`). SSE live updates via `openWorkflowInstanceEventStream`.

- [ ] **Step 1: Create the file**

```typescript
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { agentsApi } from "../api/agents.ts";
import { getRun, openWorkflowInstanceEventStream } from "../api/runs.ts";
import type { WorkflowInstanceDetail } from "../api/runs.ts";
import type { Agent } from "@journeyman/core";
import { formatDuration, isTerminalStatus } from "@journeyman/core";
import type { WorkflowInstanceEvent } from "@journeyman/core";
import { WorkflowLogsPanel, parseLogs } from "@journeyman/run-viewer";
import { btnSecondary } from "./admin-styles.ts";

const PILL_STYLE: Record<string, React.CSSProperties> = {
  running:   { background: "rgba(74,158,255,.15)",  color: "rgb(var(--color-info) / 1)" },
  completed: { background: "rgba(16,185,129,.15)",  color: "rgb(var(--color-success) / 1)" },
  failed:    { background: "rgba(239,68,68,.15)",   color: "rgb(var(--color-danger) / 1)" },
  cancelled: { background: "rgba(161,161,170,.15)", color: "rgb(var(--color-text-muted) / 1)" },
  paused:    { background: "rgba(253,203,110,.15)", color: "rgb(var(--color-warning) / 1)" },
};

function fmtRelative(dateStr: string | Date | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr as string).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)   return "just now";
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h} hr ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusPill({ status }: { status: string }) {
  const style = PILL_STYLE[status] ?? PILL_STYLE.cancelled;
  return (
    <span style={{
      ...style, display: "inline-flex", alignItems: "center", gap: 7,
      fontSize: 13, padding: "3px 10px", borderRadius: 10, fontWeight: 600,
    }}>
      {status === "running" && (
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "rgb(var(--color-info) / 1)", flexShrink: 0, animation: "jePulse 1.4s infinite" }} />
      )}
      {status}
    </span>
  );
}

export function AgentRunDetailPage() {
  const { wsId = "", runId = "" } = useParams<{ wsId: string; runId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<WorkflowInstanceDetail | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [liveEvents, setLiveEvents] = useState<WorkflowInstanceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logHeight, setLogHeight] = useState(320);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    getRun(wsId, runId)
      .then(async d => {
        setDetail(d);
        const agentId = d.workflowInstance.inputs?.agentId as string | undefined;
        if (agentId) {
          agentsApi.get(wsId, agentId).then(setAgent).catch(() => null);
        }
      })
      .catch(e => setError(e?.message ?? String(e)))
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
  if (loading) return <div style={{ padding: 24, color: "rgb(var(--color-text-muted) / 1)" }}>Loading…</div>;
  if (error || !detail) return <div style={{ padding: 24, color: "rgb(var(--color-danger) / 1)" }}>{error ?? "Run not found."}</div>;

  const wi = detail.workflowInstance;
  const agentName = agent?.name ?? (wi.inputs?.agentId as string | undefined) ?? "Agent";
  const provider  = agent?.provider ?? "claude";
  const model     = agent?.model;
  const isRunning = !isTerminalStatus(wi.status);
  const inputs    = { ...wi.inputs };
  delete inputs.agentId; // strip the internal routing key before display

  // Extract PR link from outputs if present.
  const prUrl     = wi.outputs?.prUrl as string | undefined;
  const prNumber  = wi.outputs?.prNumber as number | undefined;
  const repoName  = (wi.inputs?.repo ?? wi.inputs?.repository) as string | undefined;
  const outputText = wi.outputs?.result as string | undefined ?? wi.outputs?.summary as string | undefined;

  const logs = parseLogs(allEvents, []);

  return (
    <div style={{ height: "100%", overflowY: "auto", color: "rgb(var(--color-text) / 1)", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px 56px" }}>

        {/* Breadcrumb */}
        <div style={{ fontSize: 13, color: "rgb(var(--color-text-muted) / 1)", marginBottom: 14 }}>
          <Link to={`/workspaces/${wsId}/agent-runs`} style={{ color: "inherit", textDecoration: "none" }}>Agent Runs</Link>
          <span style={{ margin: "0 6px" }}>/</span>
          {agentName}
        </div>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>{agentName}</h1>
              <StatusPill status={wi.status} />
            </div>
            <div style={{ fontSize: 13, color: "rgb(var(--color-text-muted) / 1)", marginTop: 7, fontFamily: "ui-monospace, monospace" }}>
              {wi.id.slice(0, 8)} · {fmtRelative(wi.startedAt)}
            </div>
          </div>
          <a
            href={`/workspaces/${wsId}/workflow-instances/${wi.id}`}
            className={btnSecondary}
            style={{ textDecoration: "none" }}
          >
            Open workflow instance →
          </a>
        </div>

        {/* Stat strip */}
        <div style={{ display: "flex", gap: 48, marginTop: 32, paddingBottom: 28, borderBottom: "1px solid rgb(var(--color-border) / 1)" }}>
          {[
            { label: "Trigger",  value: wi.triggerSource },
            { label: "Duration", value: isRunning ? "running…" : formatDuration(wi.durationMs) },
            { label: "Model",    value: `${provider}${model ? ` · ${model}` : ""}` },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "rgb(var(--color-text-muted) / 1)" }}>{label}</div>
              <div style={{ fontSize: 14, marginTop: 6 }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Detail rows */}
        <div style={{ marginTop: 28, display: "grid", gridTemplateColumns: "120px 1fr", rowGap: 14, columnGap: 24, fontSize: 14 }}>
          {repoName && (
            <>
              <div style={{ color: "rgb(var(--color-text-muted) / 1)" }}>Repository</div>
              <div>
                {repoName}
                {prUrl && prNumber && (
                  <> <span style={{ color: "rgb(var(--color-text-muted) / 1)" }}>→</span>{" "}
                    <a href={prUrl} target="_blank" rel="noreferrer" style={{ color: "rgb(var(--color-text) / 1)", textDecoration: "underline", textUnderlineOffset: 3 }}>
                      PR #{prNumber}
                    </a>
                  </>
                )}
              </div>
            </>
          )}
          {Object.keys(inputs).length > 0 && (
            <>
              <div style={{ color: "rgb(var(--color-text-muted) / 1)" }}>Inputs</div>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: "rgb(var(--color-text-muted) / 1)" }}>
                {JSON.stringify(inputs)}
              </div>
            </>
          )}
          {outputText && (
            <>
              <div style={{ color: "rgb(var(--color-text-muted) / 1)" }}>Output</div>
              <div>{outputText}</div>
            </>
          )}
        </div>

        {/* Logs */}
        <div style={{ marginTop: 40 }}>
          <WorkflowLogsPanel
            events={allEvents}
            nodes={[]}
            height={logHeight}
            onResizeHeight={setLogHeight}
            onClose={() => {}}
            hideStepChips
          />
        </div>
      </div>
    </div>
  );
}
```

---

## Task 9: Wire routes in `App.tsx`

**Files:**
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Import the two new page components**

After the existing agent imports:

```typescript
import { AgentDetailPage } from "./routes/AgentDetailPage.tsx";
```

Add:

```typescript
import { AgentRunsPage } from "./routes/AgentRunsPage.tsx";
import { AgentRunDetailPage } from "./routes/AgentRunDetailPage.tsx";
```

- [ ] **Step 2: Add the two new routes**

After:

```typescript
        <Route path="/workspaces/:wsId/agents/:agentId" element={<AgentDetailPage />} />
```

Add:

```typescript
        <Route path="/workspaces/:wsId/agent-runs" element={<AgentRunsPage />} />
        <Route path="/workspaces/:wsId/agent-runs/:runId" element={<AgentRunDetailPage />} />
```

---

## Task 10: Update `RunHistorySection` links

**Files:**
- Modify: `packages/web/src/components/agents/sections/RunHistorySection.tsx`

The existing section links each run to `/workflow-instances/:id`. Update to `/agent-runs/:id` so users land on the new detail page.

- [ ] **Step 1: Update the `href` in the run table**

Find:

```tsx
                  <a className="text-primary underline" href={`/workspaces/${wsId}/workflow-instances/${r.id}`}>
```

Change to:

```tsx
                  <a className="text-primary underline" href={`/workspaces/${wsId}/agent-runs/${r.id}`}>
```

---

## Task 11: Typecheck

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors. If there are errors:
- Missing type exports from `@journeyman/run-viewer` → check Task 1 exports match `WorkflowLogsPanel.tsx` exactly.
- `WorkflowLogsPanelProps.hideStepChips` not found → check Task 2 added the prop to the interface, not just the component body.
- `agentsApi.listRuns` not found → check Task 4 added it inside the `agentsApi` object (not outside).
- `AgentRunEnriched` not exported → check `export interface AgentRunEnriched` in `agents.ts`.
- `isTerminalStatus` not found → it is exported from `@journeyman/core`; check import path in `AgentRunDetailPage.tsx`.
- `WorkflowLogsPanel` / `parseLogs` import error → check Task 1 exported both from `packages/run-viewer/src/index.ts`.
