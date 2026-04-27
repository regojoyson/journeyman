# Phase 6 — Advanced Run Actions

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Per the user's standing preference: skip unit-test steps, no per-task commits, run typecheck only at the end of the phase, parallel writes wherever possible.

**Goal:** Power-user run management. After this phase, a failed run can be (a) **resumed from a specific failed step** (Conductor's `retryWorkflow` from that task, upstream outputs preserved); (b) **forked into the editor** as a new flow with the same definition, so the user can tweak prompts/configs and re-run; (c) **paused** mid-flight and **resumed**; (d) **cancelled**; (e) **exported** as a self-contained JSON dump for offline debugging or sharing. Also closes the two Phase 3 gaps: `GET /flow_versions/:id` (so the run-detail page no longer walks `GET /flows`) and `POST /runs/:id/rerun` (so the runs list's Re-run button works).

**Architecture:** All five action endpoints live on `@journeyman/api-server`; the orchestrator gets `pause`/`resume`/`retryStep` methods plus a `forkRun`/`rerun` helper for the API layer. The Conductor client gains `pauseWorkflow`/`resumeWorkflow`/`retryWorkflow` calls. UI: the run-viewer's topbar grows Pause / Cancel buttons; the node detail drawer adds a "Retry from here" button on failed nodes; a "Fork & edit" button on terminal runs lands the user in the editor with the forked flow loaded; an "Export" button dumps a JSON file via the browser. The web shell gains a tiny `useRunActions` hook to keep route components clean.

**Tech Stack:** No new dependencies. Same `@xyflow/react`, TanStack Query, fastify, pg.

---

## Spec Reference

Source spec: `docs/superpowers/specs/2026-04-27-visual-flow-orchestration-design.md`. Implements **Section 12 → "Phase 6 — Advanced run actions"** plus the two deliberate Phase 3 stand-ins flagged inline. Out of scope:

- Per-user workspace abstraction & credential vault (Phase 7)
- Legacy package retirement (Phase 7)
- `retry-block` and `try-catch` region nodes (deferred again — they need a real region-renderer in the canvas; lining that up with the cycle visit semantics is its own piece of work)
- Visual subflow drill-in (deferred again — Phase 7 polish)

## What Changes

| Layer | Package | Change |
|---|---|---|
| Engine client | `@journeyman/orchestrator` | + `ConductorClient.pauseWorkflow`, `resumeWorkflow`, `retryWorkflow`. + `ConductorOrchestrator.pause / resume / retryFromTask`. + helpers `rerunFromExisting(runId)` and `forkFromRun(runId, opts)` (both live on the orchestrator package and use IFlowStore + IFlowVersionStore). |
| API | `@journeyman/api-server` | + `GET /flow_versions/:id` · + `POST /runs/:id/cancel` (already partially present — solidify) · + `POST /runs/:id/pause` · + `POST /runs/:id/resume` · + `POST /runs/:id/retry-step { node_id }` · + `POST /runs/:id/rerun` · + `POST /runs/:id/fork` · + `GET /runs/:id/export` (JSON dump) |
| Components | `@journeyman/run-viewer` | Topbar gains Pause / Cancel / Export buttons; node detail drawer gains "Retry from here" on failed nodes; new `onFork` prop on `<RunViewer>` |
| Components | `@journeyman/runs-list` | Re-run button uses the new `/rerun` endpoint via the `onRerun` callback (already wired in Phase 3, just no longer broken) |
| Shell | `@journeyman/web` | + API clients for all new endpoints · + `useRunActions` hook · `RunDetailPage` wires Pause / Cancel / Export / Retry-step / Fork buttons · `RunsListPage` Re-run handler now actually calls the endpoint · `FlowEditorPage` removes the version→flow heuristic helper (Phase 3 stand-in) |

## File Structure

```
packages/
├── orchestrator/
│   └── src/
│       ├── engines/conductor/
│       │   ├── conductor-client.ts             + pauseWorkflow / resumeWorkflow / retryWorkflow
│       │   └── conductor-orchestrator.ts       + pause / resume / retryFromTask
│       └── actions/
│           ├── rerun.ts                        NEW — rerunFromExisting(runId)
│           └── fork.ts                         NEW — forkFromRun(runId, { name? })
│
├── api-server/
│   └── src/routes/
│       ├── flows.ts                            + GET /flow_versions/:id (mounted via `app.get`)
│       └── runs.ts                             + cancel/pause/resume/retry-step/rerun/fork/export
│
├── run-viewer/
│   └── src/
│       ├── topbar/RunTopbar.tsx                + Pause / Cancel / Export buttons
│       ├── drawer/NodeDetailDrawer.tsx         + "Retry from here" button on failed nodes
│       ├── types.ts                            + onPause / onCancel / onExport / onRetryStep / onFork
│       └── RunViewer.tsx                       threads new callbacks through
│
├── runs-list/                                   (no source change — onRerun was already there)
│
└── web/
    └── src/
        ├── api/runs.ts                         + cancelRun / pauseRun / resumeRun / retryStep / rerunRun / forkRun / exportRun
        ├── api/flow-versions.ts                NEW — getFlowVersionById
        ├── hooks/useRunActions.ts              NEW
        └── routes/
            ├── RunDetailPage.tsx                wire all the buttons; replace heuristic with getFlowVersionById
            ├── RunsListPage.tsx                 wire onRerun
            └── FlowEditorPage.tsx               (no change — fork lands users on a new flow id, the existing seed-from-cache path handles it)
```

## Public API additions

### `@journeyman/api-server` REST surface

```
GET    /flow_versions/:id                  → { version: FlowVersion }
POST   /runs/:id/cancel    [body: { reason? }]   → { ok: true }
POST   /runs/:id/pause                            → { ok: true }
POST   /runs/:id/resume                           → { ok: true }
POST   /runs/:id/retry-step [body: { node_id }]   → { ok: true }
POST   /runs/:id/rerun                            → { runId, engineWorkflowId }
POST   /runs/:id/fork  [body: { name?: string }]  → { flow: Flow, version: FlowVersion }
GET    /runs/:id/export                           → run-bundle JSON (run + version + executions + events)
```

### `@journeyman/run-viewer`

```typescript
export interface RunViewerProps {
  // existing fields…
  onCancel?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onExport?: () => void;
  onRetryStep?: (nodeId: string) => void;
  onFork?: () => void;
}
```

---

## Task 1: Conductor client — `pauseWorkflow` / `resumeWorkflow` / `retryWorkflow`

**Files:**
- Modify: `packages/orchestrator/src/engines/conductor/conductor-client.ts`

- [ ] **Step 1.1: append three methods to `ConductorClient`**

Inside the class body, after `terminate(...)`:

```typescript
async pauseWorkflow(workflowId: string): Promise<void> {
  await this.request(`/workflow/${encodeURIComponent(workflowId)}/pause`, { method: "PUT" });
}

async resumeWorkflow(workflowId: string): Promise<void> {
  await this.request(`/workflow/${encodeURIComponent(workflowId)}/resume`, { method: "PUT" });
}

/**
 * Resume a failed/terminated workflow from its last failed task. If `taskId`
 * is omitted, Conductor retries from the last failed task in the run.
 */
async retryWorkflow(workflowId: string, opts: { taskId?: string } = {}): Promise<void> {
  const q = opts.taskId ? `?taskId=${encodeURIComponent(opts.taskId)}` : "";
  await this.request(`/workflow/${encodeURIComponent(workflowId)}/retry${q}`, { method: "POST" });
}
```

(Conductor's actual endpoints: `PUT /workflow/{id}/pause`, `PUT /workflow/{id}/resume`, `POST /workflow/{id}/retry`. The optional `taskId` query is supported on Orkes Community fork.)

---

## Task 2: `ConductorOrchestrator` — pause / resume / retryFromTask

**Files:**
- Modify: `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`

- [ ] **Step 2.1: add three methods to the class body** (after `cancel`):

```typescript
async pause(runId: string): Promise<void> {
  const r = await this.deps.runs.getById(runId);
  if (!r?.engineWorkflowId) return;
  await this.deps.client.pauseWorkflow(r.engineWorkflowId);
  await this.deps.runs.setStatus(runId, "paused");
}

async resume(runId: string): Promise<void> {
  const r = await this.deps.runs.getById(runId);
  if (!r?.engineWorkflowId) return;
  await this.deps.client.resumeWorkflow(r.engineWorkflowId);
  await this.deps.runs.setStatus(runId, "running");
}

async retryFromTask(runId: string, nodeId: string | undefined): Promise<void> {
  const r = await this.deps.runs.getById(runId);
  if (!r?.engineWorkflowId) throw new Error("Run has no engine workflow id");
  await this.deps.client.retryWorkflow(r.engineWorkflowId, { taskId: nodeId });
  await this.deps.runs.setStatus(runId, "running");
}
```

(`taskId` here is Conductor's task-reference name, which we set to the FlowNode id when emitting tasks — so the API's `node_id` flows through unchanged.)

---

## Task 3: Rerun + Fork helpers

**Files:**
- Create: `packages/orchestrator/src/actions/rerun.ts`
- Create: `packages/orchestrator/src/actions/fork.ts`
- Modify: `packages/orchestrator/src/index.ts`

These are thin orchestration helpers — they touch multiple stores, so they don't belong in any single adapter.

- [ ] **Step 3.1: `rerun.ts`**

```typescript
import type {
  IFlowVersionStore, IOrchestratorEngine, IRunStore,
} from "@journeyman/core";

export interface RerunDeps {
  runs: IRunStore;
  flowVersions: IFlowVersionStore;
  orchestrator: IOrchestratorEngine;
}

export interface RerunResult {
  runId: string;
  engineWorkflowId: string;
}

/** Submit a fresh run with the same flow version + same inputs as `originalRunId`. */
export async function rerunFromExisting(
  deps: RerunDeps,
  originalRunId: string,
  opts: { startedByUserId?: string | null } = {},
): Promise<RerunResult> {
  const original = await deps.runs.getById(originalRunId);
  if (!original) throw new Error(`Run not found: ${originalRunId}`);
  const version = await deps.flowVersions.getById(original.flowVersionId);
  if (!version) throw new Error(`Flow version not found: ${original.flowVersionId}`);

  return await deps.orchestrator.submit({
    flowVersionId: version.id,
    flowDefinition: version.definition,
    inputs: original.inputs ?? {},
    startedByUserId: opts.startedByUserId ?? original.startedByUserId,
  });
}
```

- [ ] **Step 3.2: `fork.ts`**

```typescript
import type {
  Flow, FlowVersion, IFlowStore, IFlowVersionStore, IRunStore,
} from "@journeyman/core";

export interface ForkDeps {
  runs: IRunStore;
  flows: IFlowStore;
  flowVersions: IFlowVersionStore;
}

/**
 * Create a brand-new Flow whose initial version mirrors the run's version.
 * The original flow is untouched. The user can edit the new flow freely
 * and Run it as a fresh run.
 */
export async function forkFromRun(
  deps: ForkDeps,
  originalRunId: string,
  opts: { name?: string; createdByUserId?: string | null; ownerUserId?: string | null } = {},
): Promise<{ flow: Flow; version: FlowVersion }> {
  const run = await deps.runs.getById(originalRunId);
  if (!run) throw new Error(`Run not found: ${originalRunId}`);
  const version = await deps.flowVersions.getById(run.flowVersionId);
  if (!version) throw new Error(`Flow version not found: ${run.flowVersionId}`);

  const name = opts.name ?? `Fork of run ${originalRunId.slice(0, 8)}`;
  return await deps.flows.create({
    name,
    description: `Forked from run ${originalRunId}.`,
    ownerUserId: opts.ownerUserId ?? run.startedByUserId ?? null,
    initialDefinition: version.definition,
    createdByUserId: opts.createdByUserId ?? run.startedByUserId ?? null,
  });
}
```

- [ ] **Step 3.3: barrel export from `orchestrator/src/index.ts`**

Append:

```typescript
export { rerunFromExisting } from "./actions/rerun.ts";
export { forkFromRun } from "./actions/fork.ts";
export type { RerunDeps, RerunResult } from "./actions/rerun.ts";
export type { ForkDeps } from "./actions/fork.ts";
```

---

## Task 4: API routes — flow_versions, run actions, export

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts`
- Modify: `packages/api-server/src/routes/runs.ts`

- [ ] **Step 4.1: `GET /flow_versions/:id` in `flows.ts`**

After the existing `app.get("/flows/:id/versions/current", ...)` handler, add a top-level (parallel) route. **Important:** because the existing routes are registered inside `registerFlowRoutes`, add the new handler inside the same function:

```typescript
app.get("/flow_versions/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const version = await c.flowVersions.getById(id);
  if (!version) { reply.code(404); return { error: "not_found" }; }
  return { version };
});
```

- [ ] **Step 4.2: extend `runs.ts` with all the action routes**

Add the imports at top:

```typescript
import { rerunFromExisting, forkFromRun } from "@journeyman/orchestrator";
```

Add inside `registerRunRoutes`, after the existing `GET /runs/:id/events` handler:

```typescript
app.post("/runs/:id/cancel", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as { reason?: string };
  await c.orchestrator.cancel(id, body.reason);
  return { ok: true };
});

app.post("/runs/:id/pause", async (req, reply) => {
  const { id } = req.params as { id: string };
  const orch = c.orchestrator as { pause?: (runId: string) => Promise<void> };
  if (!orch.pause) { reply.code(501); return { error: "pause_not_supported_by_engine" }; }
  await orch.pause(id);
  return { ok: true };
});

app.post("/runs/:id/resume", async (req, reply) => {
  const { id } = req.params as { id: string };
  const orch = c.orchestrator as { resume?: (runId: string) => Promise<void> };
  if (!orch.resume) { reply.code(501); return { error: "resume_not_supported_by_engine" }; }
  await orch.resume(id);
  return { ok: true };
});

app.post("/runs/:id/retry-step", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as { node_id?: string };
  const orch = c.orchestrator as { retryFromTask?: (runId: string, nodeId: string | undefined) => Promise<void> };
  if (!orch.retryFromTask) { reply.code(501); return { error: "retry_not_supported_by_engine" }; }
  await orch.retryFromTask(id, body.node_id);
  return { ok: true };
});

app.post("/runs/:id/rerun", async (req, reply) => {
  const { id } = req.params as { id: string };
  const user = await c.auth.authenticate(req);
  const result = await rerunFromExisting(
    { runs: c.runs, flowVersions: c.flowVersions, orchestrator: c.orchestrator },
    id,
    { startedByUserId: user.userId },
  );
  reply.code(202);
  return result;
});

app.post("/runs/:id/fork", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as { name?: string };
  const user = await c.auth.authenticate(req);
  const result = await forkFromRun(
    { runs: c.runs, flows: c.flows, flowVersions: c.flowVersions },
    id,
    { name: body.name, createdByUserId: user.userId, ownerUserId: user.userId },
  );
  reply.code(201);
  return result;
});

app.get("/runs/:id/export", async (req, reply) => {
  const { id } = req.params as { id: string };
  const run = await c.runs.getById(id);
  if (!run) { reply.code(404); return { error: "not_found" }; }
  const version = await c.flowVersions.getById(run.flowVersionId);
  const executions = await c.nodeExecutions.listByRun(id);
  const events = await c.events.list(id, { limit: 5000 });
  reply.header("Content-Type", "application/json");
  reply.header("Content-Disposition", `attachment; filename="run-${id}.json"`);
  return {
    exportedAt: new Date().toISOString(),
    run, version, executions, events,
  };
});
```

(Note: `pause`/`resume`/`retryFromTask` are typed loosely against `c.orchestrator` because `IOrchestratorEngine` doesn't currently declare them — they're `ConductorOrchestrator`-specific extensions. A future Phase 7 task could either widen the interface or introduce a separate `IPauseable` / `IRetryable` capability interface; for v0 the cast is fine.)

---

## Task 5: `RunViewer` — new buttons

**Files:**
- Modify: `packages/run-viewer/src/types.ts`
- Modify: `packages/run-viewer/src/topbar/RunTopbar.tsx`
- Modify: `packages/run-viewer/src/drawer/NodeDetailDrawer.tsx`
- Modify: `packages/run-viewer/src/RunViewer.tsx`

- [ ] **Step 5.1: extend `types.ts`**

In `RunViewerProps`, add (alongside existing `onRerun`/`onCancel`):

```typescript
onPause?: () => void;
onResume?: () => void;
onExport?: () => void;
onRetryStep?: (nodeId: string) => void;
onFork?: () => void;
```

- [ ] **Step 5.2: replace `RunTopbar.tsx`**

```tsx
import type { Run } from "@journeyman/core";

export interface RunTopbarProps {
  flowName: string;
  run: Run;
  onRerun?: () => void;
  onCancel?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onExport?: () => void;
  onFork?: () => void;
  busy?: boolean;
}

export function RunTopbar(p: RunTopbarProps) {
  const startedLabel = p.run.startedAt
    ? `started ${new Date(p.run.startedAt).toLocaleTimeString()}`
    : "not started";
  const isRunning = p.run.status === "running";
  const isPaused = p.run.status === "paused";
  const isTerminal = ["completed", "failed", "cancelled"].includes(p.run.status);

  const btn: React.CSSProperties = {
    background: "#2a2a3e", border: "1px solid #444", color: "#ddd",
    padding: "5px 12px", borderRadius: 5, fontSize: 12, cursor: "pointer",
  };
  const danger: React.CSSProperties = {
    ...btn, background: "rgba(255,118,117,0.10)", borderColor: "#ff7675", color: "#ff7675",
  };

  return (
    <header className="je-runview__topbar">
      <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{p.flowName}</h1>
      <span className={`je-runview__pill ${p.run.status}`}>{p.run.status}</span>
      <span style={{ color: "#888", fontSize: 11 }}>{startedLabel}</span>
      {p.run.durationMs && (
        <span style={{ color: "#888", fontSize: 11 }}>· {(p.run.durationMs / 1000).toFixed(1)}s</span>
      )}
      <div style={{ flex: 1 }} />
      {isRunning && p.onPause && (
        <button style={btn} disabled={p.busy} onClick={p.onPause}>⏸ Pause</button>
      )}
      {isPaused && p.onResume && (
        <button style={btn} disabled={p.busy} onClick={p.onResume}>▶ Resume</button>
      )}
      {!isTerminal && p.onCancel && (
        <button style={danger} disabled={p.busy} onClick={p.onCancel}>⏹ Cancel</button>
      )}
      {p.onExport && (
        <button style={btn} disabled={p.busy} onClick={p.onExport}>⬇ Export</button>
      )}
      {isTerminal && p.onFork && (
        <button style={btn} disabled={p.busy} onClick={p.onFork}>✏ Fork &amp; edit</button>
      )}
      {p.onRerun && (
        <button style={btn} disabled={p.busy} onClick={p.onRerun}>↻ Re-run</button>
      )}
    </header>
  );
}
```

- [ ] **Step 5.3: extend `NodeDetailDrawer.tsx`**

Add an `onRetryStep` prop and surface it as a button when the node's status is `failed`. Append at the very top of the file (in `NodeDetailDrawerProps`):

```typescript
onRetryStep?: () => void;
```

Then in the JSX, just before the closing `</aside>`, insert:

```tsx
{p.status?.status === "failed" && p.onRetryStep && (
  <div className="je-runview__section">
    <button
      onClick={p.onRetryStep}
      style={{
        background: "#fdcb6e", border: "none", color: "#1a1a24",
        padding: "6px 12px", borderRadius: 4, fontSize: 12, fontWeight: 600,
        cursor: "pointer", width: "100%",
      }}
    >↻ Retry from this step</button>
  </div>
)}
```

- [ ] **Step 5.4: thread the new callbacks through `RunViewer.tsx`**

Replace the topbar invocation:

```tsx
<RunTopbar
  flowName={props.flowName ?? "Run"}
  run={props.run}
  onRerun={props.onRerun}
  onCancel={props.onCancel}
  onPause={props.onPause}
  onResume={props.onResume}
  onExport={props.onExport}
  onFork={props.onFork}
/>
```

And the drawer invocation:

```tsx
<NodeDetailDrawer
  nodeId={selectedNodeId}
  displayName={selectedDisplayName}
  status={selectedNodeId ? (statuses.get(selectedNodeId) ?? null) : null}
  events={eventsForSelected}
  executions={execsForSelected}
  onRetryStep={selectedNodeId && props.onRetryStep
    ? () => props.onRetryStep!(selectedNodeId)
    : undefined}
/>
```

---

## Task 6: Web — new API client functions

**Files:**
- Create: `packages/web/src/api/flow-versions.ts`
- Modify: `packages/web/src/api/runs.ts`

- [ ] **Step 6.1: `flow-versions.ts`**

```typescript
import type { FlowVersion } from "@journeyman/core";
import { api } from "./client.ts";

export async function getFlowVersionById(id: string): Promise<FlowVersion> {
  const res = await api<{ version: FlowVersion }>(`/flow_versions/${encodeURIComponent(id)}`);
  return res.version;
}
```

- [ ] **Step 6.2: extend `api/runs.ts`** — append after the existing `openRunEventStream` function:

```typescript
import type { Flow } from "@journeyman/core";

export async function cancelRun(runId: string, reason?: string): Promise<void> {
  await api(`/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST", body: JSON.stringify({ reason }),
  });
}

export async function pauseRun(runId: string): Promise<void> {
  await api(`/runs/${encodeURIComponent(runId)}/pause`, { method: "POST", body: "{}" });
}

export async function resumeRun(runId: string): Promise<void> {
  await api(`/runs/${encodeURIComponent(runId)}/resume`, { method: "POST", body: "{}" });
}

export async function retryStep(runId: string, nodeId: string): Promise<void> {
  await api(`/runs/${encodeURIComponent(runId)}/retry-step`, {
    method: "POST", body: JSON.stringify({ node_id: nodeId }),
  });
}

export async function rerunRun(runId: string): Promise<{ runId: string; engineWorkflowId: string }> {
  return await api(`/runs/${encodeURIComponent(runId)}/rerun`, {
    method: "POST", body: "{}",
  });
}

export async function forkRun(runId: string, name?: string): Promise<{ flow: Flow; version: import("@journeyman/core").FlowVersion }> {
  return await api(`/runs/${encodeURIComponent(runId)}/fork`, {
    method: "POST", body: JSON.stringify({ name }),
  });
}

export function exportRunUrl(runId: string): string {
  const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:4000";
  return `${baseUrl}/runs/${encodeURIComponent(runId)}/export`;
}
```

---

## Task 7: `useRunActions` hook

**Files:**
- Create: `packages/web/src/hooks/useRunActions.ts`

A thin TanStack-Query mutation hub so each route component doesn't re-declare 7 mutations.

- [ ] **Step 7.1: write the hook**

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  cancelRun, pauseRun, resumeRun, retryStep, rerunRun, forkRun, exportRunUrl,
} from "../api/runs.ts";

export function useRunActions(runId: string | undefined) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const invalidate = () => {
    if (!runId) return;
    qc.invalidateQueries({ queryKey: ["run-detail", runId] });
    qc.invalidateQueries({ queryKey: ["runs"] });
  };

  const cancel = useMutation({
    mutationFn: () => cancelRun(runId!),
    onSuccess: invalidate,
  });
  const pause = useMutation({
    mutationFn: () => pauseRun(runId!),
    onSuccess: invalidate,
  });
  const resume = useMutation({
    mutationFn: () => resumeRun(runId!),
    onSuccess: invalidate,
  });
  const retry = useMutation({
    mutationFn: (nodeId: string) => retryStep(runId!, nodeId),
    onSuccess: invalidate,
  });
  const rerun = useMutation({
    mutationFn: () => rerunRun(runId!),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/runs/${res.runId}`);
    },
  });
  const fork = useMutation({
    mutationFn: () => forkRun(runId!),
    onSuccess: ({ flow }) => {
      qc.invalidateQueries({ queryKey: ["flows"] });
      navigate(`/flows/${flow.id}/edit`);
    },
  });

  const exportRun = () => {
    if (!runId) return;
    const a = document.createElement("a");
    a.href = exportRunUrl(runId);
    a.download = `run-${runId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return { cancel, pause, resume, retry, rerun, fork, exportRun };
}
```

---

## Task 8: `RunDetailPage` — wire all the buttons + remove Phase 3 heuristic

**Files:**
- Modify: `packages/web/src/routes/RunDetailPage.tsx`

Replace the file:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { RunViewer } from "@journeyman/run-viewer";
import type { RunEvent } from "@journeyman/core";
import { getRun, openRunEventStream } from "../api/runs.ts";
import { getFlowVersionById } from "../api/flow-versions.ts";
import { useRunActions } from "../hooks/useRunActions.ts";

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [liveEvents, setLiveEvents] = useState<RunEvent[]>([]);
  const actions = useRunActions(id);

  const detailQ = useQuery({
    queryKey: ["run-detail", id],
    queryFn: () => getRun(id!),
    enabled: !!id,
  });

  const versionId = detailQ.data?.run.flowVersionId;
  const versionQ = useQuery({
    queryKey: ["flow-version-by-id", versionId],
    queryFn: () => getFlowVersionById(versionId!),
    enabled: !!versionId,
  });

  // Open SSE once we have the run loaded.
  useEffect(() => {
    if (!id || !detailQ.data) return;
    const lastId = detailQ.data.events.at(-1)?.id ?? 0;
    const close = openRunEventStream({
      runId: id, sinceId: lastId,
      onEvent: (ev) => setLiveEvents(prev => [...prev, ev]),
    });
    return close;
  }, [id, detailQ.data]);

  const allEvents = useMemo(() => [
    ...(detailQ.data?.events ?? []),
    ...liveEvents,
  ], [detailQ.data?.events, liveEvents]);

  if (!id) { navigate("/runs"); return null; }
  if (detailQ.isLoading) return <div style={{ padding: 24, color: "#888" }}>Loading run…</div>;
  if (detailQ.isError || !detailQ.data) return <div style={{ padding: 24, color: "#ff7675" }}>Run not found.</div>;
  if (versionQ.isLoading || !versionQ.data) {
    return <div style={{ padding: 24, color: "#888" }}>Loading flow definition…</div>;
  }

  const busy = actions.cancel.isPending || actions.pause.isPending || actions.resume.isPending
    || actions.retry.isPending || actions.rerun.isPending || actions.fork.isPending;

  return (
    <div style={{ height: "100%" }}>
      <RunViewer
        flow={versionQ.data.definition}
        flowName={`Flow v${versionQ.data.versionNumber}`}
        run={detailQ.data.run}
        events={allEvents}
        executions={detailQ.data.executions}
        onCancel={() => actions.cancel.mutate()}
        onPause={() => actions.pause.mutate()}
        onResume={() => actions.resume.mutate()}
        onExport={actions.exportRun}
        onRetryStep={(nodeId) => actions.retry.mutate(nodeId)}
        onRerun={() => actions.rerun.mutate()}
        onFork={() => actions.fork.mutate()}
      />
      {busy && (
        <div style={{ position: "fixed", bottom: 16, left: 16, color: "#888", fontSize: 11 }}>
          working…
        </div>
      )}
    </div>
  );
}
```

(Note: the prior page used `flowName` from the run's parent flow via the heuristic walk; v6 simplifies by labelling the run with its version number — Phase 7 may add a join in the API to surface the parent flow name without an extra call.)

---

## Task 9: `RunsListPage` — wire the Re-run button

**Files:**
- Modify: `packages/web/src/routes/RunsListPage.tsx`

Replace the file:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RunsList, type RunFilter } from "@journeyman/runs-list";
import type { Run } from "@journeyman/core";
import { listRuns, rerunRun } from "../api/runs.ts";

export function RunsListPage() {
  const [filter, setFilter] = useState<RunFilter>({});
  const navigate = useNavigate();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["runs", filter],
    queryFn: () => listRuns({ status: filter.status, flowId: filter.flowId }),
    refetchInterval: 4000,
  });

  const rerunM = useMutation({
    mutationFn: (r: Run) => rerunRun(r.id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/runs/${res.runId}`);
    },
  });

  return (
    <RunsList
      runs={q.data ?? []}
      isLoading={q.isLoading}
      filter={filter}
      onFilterChange={setFilter}
      onSelectRun={(id) => navigate(`/runs/${id}`)}
      onRerun={(r) => rerunM.mutate(r)}
    />
  );
}
```

---

## Task 10: install + repo-wide typecheck + manual smoke

- [ ] **Step 10.1: `npm install`** (no new deps; just relinks).

- [ ] **Step 10.2: typecheck**

```bash
npm run typecheck
```
Expected: green across all 16 workspaces.

- [ ] **Step 10.3: smoke test**

1. Stack up: `npm run infra:up && npm run migrate && npm run start:api-server & npm run start:worker & npm run dev:web`
2. Build a simple flow that fails (e.g. analyze with bad inputs). Click **Run** → toast → **View live →**.
3. The run reaches `failed`. The topbar now shows **Export** and **Fork & edit** and **Re-run** buttons.
4. Click the failed analyze node in the canvas → drawer opens → **Retry from this step** button is visible.
5. Click **Retry from this step** → status flips to `running`, the node animates blue, and (depending on your handler) either succeeds on second attempt or fails again.
6. Click **Fork & edit** → URL changes to `/flows/<new-id>/edit` with a copy of the definition; user fixes the prompt; **Save** + **Run** → new toast.
7. While that new run is running, click **Pause** → status pill flips to `paused`. Click **Resume** → status flips back to `running`.
8. Click **Cancel** on a running run → status flips to `cancelled`.
9. Click **Export** → browser downloads `run-<id>.json` containing run + version + executions + events.
10. Navigate to **Runs** list → click **Re-run** on an old row → new run appears + you land on its detail page.

---

## Self-Review Checklist

**Spec coverage (Phase 6 from §12):**
- [x] Resume from failed step (Conductor `retryWorkflow` from a specific task) — Tasks 1, 2, 4 (`/retry-step`), 5.3, 7, 8
- [x] Fork-edit (open a finished run as an editor draft) — Tasks 3.2, 4 (`/fork`), 5, 7, 8
- [x] Pause / Cancel buttons on the run view — Tasks 1, 2, 4, 5.2, 7, 8
- [x] Export run as JSON — Tasks 4 (`GET /runs/:id/export`), 6.2 (`exportRunUrl`), 7

**Phase 3 gap closures:**
- [x] `GET /flow_versions/:id` endpoint — Task 4.1; `RunDetailPage` no longer walks `GET /flows`
- [x] `POST /runs/:id/rerun` endpoint — Task 4.2; `RunsListPage` Re-run actually works

**Out of scope deferred:**
- `retry-block` and `try-catch` region nodes — Phase 7+
- Visual subflow drill-in — Phase 7+
- Resume that lets the user *edit inputs* before resuming a single step — Phase 7 polish (current resume preserves upstream outputs but doesn't expose an edit form)
- Pause/Resume/Retry on `IOrchestratorEngine` — kept as `ConductorOrchestrator`-specific extensions; Phase 7 widens the interface or introduces capability interfaces (`IPauseable`, `IRetryable`)

**Type consistency:**
- `Run.status` already includes `"paused"` (Phase 1 type), so `RunSyncer`'s status mapping and `RunTopbar`'s pill rendering both work without further changes.
- `taskReferenceName` in Conductor JSON equals our `FlowNode.id`; `retry-step { node_id }` flows through unchanged.
- `forkFromRun` returns `{ flow, version }` — the same shape as `POST /flows`; UI navigates to the new flow id directly.

**Phase 6 known limitations (deliberate):**
- Pause/Resume/Retry are typed against `c.orchestrator` via an inline structural cast in the route handlers because `IOrchestratorEngine` doesn't declare them. Switching engines (Phase 7+) would surface an HTTP 501 from the route until the new engine implements them.
- Fork creates a brand-new flow rather than a new version on the same flow — keeps the original flow clean. Power users who want a "new version on same flow" workflow can use the editor's regular Save flow against the original after forking.
- `RunDetailPage` no longer surfaces the parent flow's friendly name (it shows `Flow v<n>` instead). Re-adding the flow name requires a tiny join in the API; flagged as a Phase 7 polish item.
