# Phase 3 — Live Run View + Run History

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Per the user's preference: unit-test steps omitted, no per-task commits, typecheck only at end of phase, parallel writes wherever possible.

**Goal:** Bring run observation into the product. After clicking **Run**, the user lands on a live canvas that animates as Conductor executes the flow — pending/running/completed/failed nodes color-coded, click any node for a detail drawer with input/output/logs/attempts. A Runs list page shows history with filters; rerun one click. Closes the Phase 2 gap by adding `GET /flows/:id/versions/current` so reopening a saved flow shows the real graph instead of a blank canvas.

**Architecture:** Two new pure-component packages mirror the Phase 2 split: `@journeyman/run-viewer` (read-only canvas + click-to-open detail drawer) and `@journeyman/runs-list` (sortable, filterable table). The api-server gains an SSE endpoint that streams `RunEvent`s from Postgres in real time. A new `RunSyncer` in orchestrator polls Conductor for active runs and synthesizes workflow-level events (running, completed, failed) into the `IEventBus` so the SSE stream is complete — phase events come from the worker, run events come from the syncer.

**Tech Stack:** Same as Phase 2 (React 18, Vite 5, TypeScript strict, `@xyflow/react`, TanStack Query, react-router-dom). For SSE we use the browser's `EventSource` API — no extra dependency.

---

## Spec Reference

Source spec: `docs/superpowers/specs/2026-04-27-visual-flow-orchestration-design.md`. Implements **Section 12 → "Phase 3 — Live run view + run history"** plus the small `versions/current` API hole left from Phase 2. Out of scope for Phase 3: gateways/loops (Phase 4), MCP/credentials/retry/IO tabs (Phase 5), resume-from-failed/fork-edit (Phase 6).

## What's New / Extended

| Layer | Package | Change |
|---|---|---|
| API | `@journeyman/api-server` | + `GET /flows/:id/versions/current` · + `GET /runs?flow_id=&status=&limit=` · + `GET /runs/:id/events` (SSE) · `GET /runs/:id` returns events + node executions (already does, ensure stable shape) |
| Engine | `@journeyman/orchestrator` | + `RunSyncer` background service: polls Conductor for active runs, syncs `RunStatus`, emits `run.*` events to `IEventBus` |
| Components | `@journeyman/run-viewer` (NEW) | `<RunViewer>` pure read-only canvas + node detail drawer |
| Components | `@journeyman/runs-list` (NEW) | `<RunsList>` pure table component |
| Shell | `@journeyman/web` | + `/runs` route · + `/runs/:id` route · refactor toast → navigate; close Phase 2 gap by hitting `versions/current` |

Legacy `packages/ui`, `packages/pipeline`, `packages/pipeline-server` remain frozen.

## File Structure

```
packages/
├── api-server/                                 (extended)
│   └── src/
│       ├── routes/
│       │   ├── flows.ts                        + GET /flows/:id/versions/current
│       │   └── runs.ts                         + GET /runs (list); + GET /runs/:id/events (SSE)
│       └── sse/
│           └── sse-stream.ts                   helper to format & flush SSE on a Fastify reply
│
├── orchestrator/                               (extended)
│   └── src/
│       ├── sync/
│       │   ├── run-syncer.ts                   polls Conductor for active runs, emits events
│       │   └── run-syncer.types.ts             SyncerConfig, exported handle types
│       └── index.ts                            + RunSyncer export
│
├── run-viewer/                                 NEW — @journeyman/run-viewer
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                            barrel
│       ├── RunViewer.tsx                       top-level component
│       ├── canvas/
│       │   ├── ReadOnlyCanvas.tsx              React Flow read-only with status decoration
│       │   └── status-styles.ts                pending/running/completed/failed CSS class map
│       ├── status/
│       │   ├── compute-node-status.ts          pure: derive node status from RunEvent[] + NodeExecution[]
│       │   └── compute-node-status.types.ts
│       ├── drawer/
│       │   └── NodeDetailDrawer.tsx            input/output/logs/attempts viewer
│       ├── topbar/
│       │   └── RunTopbar.tsx                   status pill, started-at, Re-run button
│       ├── styles.css                          status colors + drawer layout
│       └── types.ts                            public prop interfaces
│
├── runs-list/                                  NEW — @journeyman/runs-list
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── RunsList.tsx                        the table
│       ├── RunFilters.tsx                      status + flow filter strip
│       ├── styles.css
│       └── types.ts
│
└── web/                                        (extended)
    └── src/
        ├── api/
        │   ├── flows.ts                        + getCurrentFlowVersion
        │   └── runs.ts                         NEW — listRuns, getRun, openRunEventStream
        ├── routes/
        │   ├── FlowsListPage.tsx               (no change)
        │   ├── FlowEditorPage.tsx              uses getCurrentFlowVersion → no more blank-on-reopen
        │   ├── NewFlowPage.tsx                 (no change)
        │   ├── RunsListPage.tsx                NEW
        │   └── RunDetailPage.tsx               NEW
        ├── components/
        │   ├── AppShell.tsx                    + Runs nav link
        │   └── RunSubmittedToast.tsx           secondary "View live →" button
        └── App.tsx                             + /runs and /runs/:id routes
```

## Public API of `@journeyman/run-viewer`

```typescript
import type { FlowGraph, NodeExecution, Run, RunEvent } from "@journeyman/core";

export type NodeStatus =
  | "pending"
  | "running"
  | "retry-backoff"
  | "completed"
  | "failed"
  | "cancelled";

export interface ResolvedNodeStatus {
  status: NodeStatus;
  attempt: number;          // 1-based, 0 if not started
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  errorClass?: string;
  visitCount: number;       // for cycle UX (Phase 4 uses it; Phase 3 always 0 or 1)
}

export interface RunViewerProps {
  flow: FlowGraph;
  run: Run;
  /**
   * Append-only stream of run events. The viewer derives per-node status
   * from these. Hosts using SSE pass the cumulative array; whenever a new
   * event arrives, push a new array reference (immutable update).
   */
  events: RunEvent[];
  /** Persisted node executions (input/output/error). */
  executions: NodeExecution[];
  /** Re-run callback. When provided, shows the Re-run button. */
  onRerun?: () => void;
  /** Cancel callback (Phase 6 will wire it; Phase 3 component supports it but UI doesn't expose). */
  onCancel?: () => void;
  /** Open this node's detail drawer programmatically. */
  initialSelectedNodeId?: string | null;
}

export function RunViewer(props: RunViewerProps): JSX.Element;

/** Pure helper — exported so server-side renderers / tests can use it. */
export function computeNodeStatuses(args: {
  flow: FlowGraph;
  events: RunEvent[];
  executions: NodeExecution[];
  runStatus: Run["status"];
}): Map<string, ResolvedNodeStatus>;
```

## Public API of `@journeyman/runs-list`

```typescript
import type { Run } from "@journeyman/core";

export interface RunFilter {
  status?: Run["status"];
  flowId?: string;
}

export interface RunsListProps {
  runs: Run[];
  isLoading?: boolean;
  filter: RunFilter;
  onFilterChange: (next: RunFilter) => void;
  onSelectRun: (runId: string) => void;
  onRerun?: (run: Run) => void;
  /** Map flow_version_id -> friendly name (for the "Flow" column). Optional. */
  flowNameByVersionId?: Record<string, string>;
}

export function RunsList(props: RunsListProps): JSX.Element;
```

---

## Task 1: Close Phase 2 gap — `GET /flows/:id/versions/current`

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts`
- Modify: `packages/web/src/api/flows.ts`
- Modify: `packages/web/src/routes/FlowEditorPage.tsx`

- [ ] **Step 1.1: add the route in `flows.ts`**

Inside `registerFlowRoutes`, after the existing `app.put("/flows/:id", ...)` handler:

```typescript
app.get("/flows/:id/versions/current", async (req, reply) => {
  const { id } = req.params as { id: string };
  const flow = await c.flows.getById(id);
  if (!flow) { reply.code(404); return { error: "not_found" }; }
  if (!flow.currentVersionId) { reply.code(409); return { error: "flow_has_no_versions" }; }
  const version = await c.flowVersions.getById(flow.currentVersionId);
  if (!version) { reply.code(500); return { error: "version_missing" }; }
  return { version };
});
```

- [ ] **Step 1.2: add the client function in `web/src/api/flows.ts`**

```typescript
import type { FlowVersion } from "@journeyman/core";

// add at end of file
export async function getCurrentFlowVersion(flowId: string): Promise<FlowVersion> {
  const res = await api<{ version: FlowVersion }>(`/flows/${encodeURIComponent(flowId)}/versions/current`);
  return res.version;
}
```

- [ ] **Step 1.3: rewrite `FlowEditorPage.tsx` to use it**

Replace the whole file (only changes are: a second query for the current version, simpler effect). Verbatim:

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlowEditor } from "@journeyman/flow-editor";
import type { FlowGraph } from "@journeyman/core";
import { getFlow, getCurrentFlowVersion, runFlow, updateFlowDefinition } from "../api/flows.ts";
import { builtInPhaseCatalog } from "../catalogs/built-in-phase-catalog.ts";
import { RunSubmittedToast } from "../components/RunSubmittedToast.tsx";

export function FlowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [graph, setGraph] = useState<FlowGraph | null>(null);
  const [, setDirty] = useState(false);
  const [toast, setToast] = useState<{ runId: string; engineWorkflowId: string } | null>(null);

  const flowQ = useQuery({
    queryKey: ["flow", id],
    queryFn: () => getFlow(id!),
    enabled: !!id,
  });

  const versionQ = useQuery({
    queryKey: ["flow-version-current", id],
    queryFn: () => getCurrentFlowVersion(id!),
    enabled: !!id && !!flowQ.data,
  });

  // Seed editor state when version arrives (or use cached graph from a just-created flow)
  useEffect(() => {
    if (!id || graph) return;
    const cached = qc.getQueryData<FlowGraph>(["flow-graph", id]);
    if (cached) { setGraph(cached); return; }
    if (versionQ.data) setGraph(versionQ.data.definition);
  }, [id, graph, qc, versionQ.data]);

  const saveM = useMutation({
    mutationFn: (next: FlowGraph) => updateFlowDefinition(id!, next),
    onSuccess: (_, next) => {
      qc.setQueryData(["flow-graph", id], next);
      qc.invalidateQueries({ queryKey: ["flow-version-current", id] });
      setDirty(false);
    },
  });

  const runM = useMutation({
    mutationFn: () => runFlow(id!, {}),
    onSuccess: (res) => setToast(res),
  });

  if (!id) { navigate("/flows"); return null; }
  if (flowQ.isLoading || versionQ.isLoading || !graph) {
    return <div style={{ padding: 24, color: "#888" }}>Loading editor…</div>;
  }
  if (flowQ.isError || !flowQ.data) {
    return <div style={{ padding: 24, color: "#ff7675" }}>Flow not found.</div>;
  }

  return (
    <>
      <div style={{ height: "100%" }}>
        <FlowEditor
          flow={graph}
          flowName={flowQ.data.name}
          phaseCatalog={builtInPhaseCatalog}
          onChange={(next) => { setGraph(next); setDirty(true); }}
          onSave={async (next) => { await saveM.mutateAsync(next); }}
          onRun={async () => { await runM.mutateAsync(); }}
          busy={saveM.isPending || runM.isPending}
        />
      </div>
      {toast && (
        <RunSubmittedToast
          runId={toast.runId}
          engineWorkflowId={toast.engineWorkflowId}
          onViewLive={() => navigate(`/runs/${toast.runId}`)}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  );
}
```

(Note: `RunSubmittedToast` gains an `onViewLive` callback in Task 9.)

---

## Task 2: SSE helper + `GET /runs` + `GET /runs/:id/events`

**Files:**
- Create: `packages/api-server/src/sse/sse-stream.ts`
- Modify: `packages/api-server/src/routes/runs.ts`

- [ ] **Step 2.1: write the SSE helper**

```typescript
// packages/api-server/src/sse/sse-stream.ts
import type { FastifyReply } from "fastify";

/**
 * Tiny SSE writer. Call openSseStream() once per request, then send() per event.
 * Closes when client disconnects or close() is called.
 */
export interface SseStream {
  send(event: { id?: number | string; event?: string; data: unknown }): void;
  ping(): void;
  close(): Promise<void>;
}

export function openSseStream(reply: FastifyReply): SseStream {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  reply.raw.flushHeaders?.();

  let closed = false;

  const send = (e: { id?: number | string; event?: string; data: unknown }) => {
    if (closed) return;
    let buf = "";
    if (e.id !== undefined) buf += `id: ${e.id}\n`;
    if (e.event) buf += `event: ${e.event}\n`;
    buf += `data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}\n\n`;
    reply.raw.write(buf);
  };

  const ping = () => {
    if (closed) return;
    reply.raw.write(`: ping\n\n`);
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    reply.raw.end();
  };

  reply.raw.on("close", () => { closed = true; });

  return { send, ping, close };
}
```

- [ ] **Step 2.2: extend `routes/runs.ts`**

Replace the file. `GET /runs/:id` keeps the same response shape; `GET /runs` and `GET /runs/:id/events` are added.

```typescript
import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { openSseStream } from "../sse/sse-stream.ts";
import type { RunStatus } from "@journeyman/core";

const PING_INTERVAL_MS = 15_000;

export function registerRunRoutes(app: FastifyInstance, c: Composition): void {
  app.get("/runs", async (req) => {
    const q = req.query as { flow_id?: string; status?: string; limit?: string };
    const limit = q.limit ? Number(q.limit) : undefined;
    const status = q.status as RunStatus | undefined;
    const runs = await c.runs.list({ flowId: q.flow_id, status, limit });
    return { runs };
  });

  app.get("/runs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await c.orchestrator.syncStatus(id).catch(() => { /* best-effort */ });
    const run = await c.runs.getById(id);
    if (!run) { reply.code(404); return { error: "not_found" }; }
    const executions = await c.nodeExecutions.listByRun(id);
    const events = await c.events.list(id, { limit: 500 });
    return { run, executions, events };
  });

  app.get("/runs/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    const sinceId = (req.query as { since?: string }).since;
    const since = sinceId ? Number(sinceId) : 0;

    const run = await c.runs.getById(id);
    if (!run) { reply.code(404); return { error: "not_found" }; }

    const stream = openSseStream(reply);
    const ping = setInterval(() => stream.ping(), PING_INTERVAL_MS);
    let closed = false;
    reply.raw.on("close", () => { closed = true; clearInterval(ping); });

    // Replay history first, then live-stream
    try {
      const backfill = await c.events.list(id, { sinceId: since });
      for (const ev of backfill) {
        if (closed) return;
        stream.send({ id: ev.id, event: ev.eventType, data: ev });
      }
      const start = backfill.at(-1)?.id ?? since;
      for await (const ev of c.events.subscribe(id, { sinceId: start })) {
        if (closed) break;
        stream.send({ id: ev.id, event: ev.eventType, data: ev });
        // Auto-close once the run reaches a terminal status.
        if (ev.eventType === "run.completed" || ev.eventType === "run.failed" || ev.eventType === "run.cancelled") {
          // Give the client a brief beat to receive the final event before closing.
          setTimeout(() => stream.close(), 500);
          break;
        }
      }
    } finally {
      clearInterval(ping);
      await stream.close();
    }
  });
}
```

---

## Task 3: `RunSyncer` — bridge Conductor lifecycle into `IEventBus`

**Files:**
- Create: `packages/orchestrator/src/sync/run-syncer.ts`
- Modify: `packages/orchestrator/src/index.ts`

The syncer fills a real gap: workers emit `phase.*` events, but **run-level transitions (started, completed, failed, cancelled) only exist in Conductor**. Without the syncer, the SSE stream never closes and the canvas never shows a terminal state. The syncer polls Conductor for runs whose persisted status is non-terminal, calls `syncStatus()` (which is already implemented), and emits the matching `run.*` event into the bus when the status changes.

- [ ] **Step 3.1: write `run-syncer.ts`**

```typescript
import { createLogger } from "@journeyman/core";
import type { IEventBus, IOrchestratorEngine, IRunStore, RunStatus } from "@journeyman/core";

const log = createLogger("orchestrator:syncer");

export interface RunSyncerDeps {
  runs: IRunStore;
  orchestrator: IOrchestratorEngine;
  events: IEventBus;
  intervalMs?: number;
}

const NON_TERMINAL: RunStatus[] = ["pending", "running", "paused"];

export class RunSyncer {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private deps: RunSyncerDeps) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try { await this.syncOnce(); }
      catch (err) { log.error({ err }, "sync tick failed"); }
      this.timer = setTimeout(tick, this.deps.intervalMs ?? 1500);
    };
    void tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Test seam. */
  async syncOnce(): Promise<void> {
    // Sweep each non-terminal status separately to keep the IRunStore.list contract narrow.
    const active: Array<Awaited<ReturnType<IRunStore["list"]>>> = await Promise.all(
      NON_TERMINAL.map(s => this.deps.runs.list({ status: s, limit: 200 })),
    );
    const allActive = active.flat();
    for (const r of allActive) {
      const previous = r.status;
      const live = await this.deps.orchestrator.syncStatus(r.id).catch((err) => {
        log.warn({ runId: r.id, err: err?.message }, "syncStatus failed");
        return null;
      });
      if (!live || live === previous) continue;

      const eventType = mapStatusToEvent(live);
      if (eventType) {
        await this.deps.events.append({
          runId: r.id,
          eventType,
          payload: { status: live, previousStatus: previous },
        });
      }
    }
  }
}

function mapStatusToEvent(s: RunStatus): import("@journeyman/core").RunEventType | null {
  switch (s) {
    case "running":   return "run.started";
    case "completed": return "run.completed";
    case "failed":    return "run.failed";
    case "cancelled": return "run.cancelled";
    default:          return null;
  }
}
```

- [ ] **Step 3.2: export from `orchestrator/src/index.ts`**

Add to the barrel:

```typescript
export { RunSyncer } from "./sync/run-syncer.ts";
```

- [ ] **Step 3.3: start the syncer from `api-server/src/cli-start.ts`**

Below `composition = buildComposition(cfg)` and before `await server.listen(...)`, add:

```typescript
import { RunSyncer } from "@journeyman/orchestrator";
// …
const syncer = new RunSyncer({
  runs: composition.runs,
  orchestrator: composition.orchestrator,
  events: composition.events,
  intervalMs: Number(process.env.RUN_SYNC_INTERVAL_MS ?? 1500),
});
syncer.start();
```

And in the existing `shutdown` handler, before `composition.shutdown()`:

```typescript
syncer.stop();
```

---

## Task 4: Scaffold `@journeyman/run-viewer`

**Files:**
- Create: `packages/run-viewer/package.json`
- Create: `packages/run-viewer/tsconfig.json`
- Create: `packages/run-viewer/src/css.d.ts`
- Create: `packages/run-viewer/src/types.ts`
- Create: `packages/run-viewer/src/index.ts` (placeholder barrel)

- [ ] **Step 4.1: `package.json`** — same dep set as flow-editor (React Flow + lucide).

```json
{
  "name": "@journeyman/run-viewer",
  "version": "0.1.0",
  "description": "Read-only canvas + node detail drawer for live and historical Journeyman run views.",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": { "typecheck": "tsc --noEmit" },
  "peerDependencies": { "react": "^18.3.0", "react-dom": "^18.3.0" },
  "dependencies": {
    "@journeyman/core": "*",
    "@journeyman/flow-editor": "*",
    "@xyflow/react": "^12.3.5",
    "lucide-react": "^0.400.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 4.2: `tsconfig.json`** — copy verbatim from `packages/flow-editor/tsconfig.json`.

- [ ] **Step 4.3: `css.d.ts`** — `declare module "*.css";`

- [ ] **Step 4.4: `types.ts`** — verbatim from "Public API of `@journeyman/run-viewer`" above.

- [ ] **Step 4.5: `index.ts`** — placeholder barrel:

```typescript
export type { RunViewerProps, NodeStatus, ResolvedNodeStatus } from "./types.ts";
```

---

## Task 5: `computeNodeStatuses` — pure derivation

**Files:**
- Create: `packages/run-viewer/src/status/compute-node-status.ts`

A run's per-node status is reconstructed from the event log + persisted node executions. Pure function, easy to test, easy to reason about.

- [ ] **Step 5.1: implement**

```typescript
import type {
  FlowGraph, NodeExecution, RunEvent, RunStatus,
} from "@journeyman/core";
import type { NodeStatus, ResolvedNodeStatus } from "../types.ts";

export interface ComputeArgs {
  flow: FlowGraph;
  events: RunEvent[];
  executions: NodeExecution[];
  runStatus: RunStatus;
}

export function computeNodeStatuses(args: ComputeArgs): Map<string, ResolvedNodeStatus> {
  const out = new Map<string, ResolvedNodeStatus>();
  for (const n of args.flow.nodes) {
    out.set(n.id, { status: "pending", attempt: 0, visitCount: 0 });
  }

  // Walk events oldest-first
  const sorted = [...args.events].sort((a, b) => a.id - b.id);
  for (const ev of sorted) {
    const id = ev.nodeId;
    if (!id) continue;
    const cur = out.get(id);
    if (!cur) continue;

    switch (ev.eventType) {
      case "phase.started": {
        cur.status = "running";
        const a = (ev.payload as { attempt?: number }).attempt;
        if (typeof a === "number") cur.attempt = a;
        cur.visitCount += 1;
        cur.startedAt ??= new Date(ev.ts);
        break;
      }
      case "phase.retrying":
        cur.status = "retry-backoff";
        break;
      case "phase.failed":
        cur.status = "failed";
        cur.completedAt = new Date(ev.ts);
        cur.errorClass = (ev.payload as { error?: { errorClass?: string } }).error?.errorClass;
        if (cur.startedAt && cur.completedAt) {
          cur.durationMs = cur.completedAt.getTime() - cur.startedAt.getTime();
        }
        break;
      case "phase.completed":
        cur.status = "completed";
        cur.completedAt = new Date(ev.ts);
        if (cur.startedAt && cur.completedAt) {
          cur.durationMs = cur.completedAt.getTime() - cur.startedAt.getTime();
        }
        break;
    }
    out.set(id, cur);
  }

  // If the run itself is cancelled, surface that on any non-terminal nodes.
  if (args.runStatus === "cancelled") {
    for (const [id, v] of out) {
      if (v.status === "pending" || v.status === "running" || v.status === "retry-backoff") {
        out.set(id, { ...v, status: "cancelled" });
      }
    }
  }

  // Cross-check with persisted executions for richer attempt counts.
  for (const e of args.executions) {
    const cur = out.get(e.nodeId);
    if (!cur) continue;
    if (e.attempt > cur.attempt) cur.attempt = e.attempt;
    if (!cur.errorClass && e.errorClass) cur.errorClass = e.errorClass;
    out.set(e.nodeId, cur);
  }
  return out;
}

export type { NodeStatus, ResolvedNodeStatus };
```

---

## Task 6: read-only canvas with status decoration

**Files:**
- Create: `packages/run-viewer/src/canvas/status-styles.ts`
- Create: `packages/run-viewer/src/canvas/ReadOnlyCanvas.tsx`
- Create: `packages/run-viewer/src/styles.css`

The canvas reuses `@journeyman/flow-editor`'s node components but overrides their styling via wrapping CSS classes — keeping a single source of truth for the n8n look. The `data` blob fed to React Flow nodes carries the resolved status; a top-level wrapper element on each node gets a `je-runnode--<status>` class that the new stylesheet decorates.

- [ ] **Step 6.1: `status-styles.ts`**

```typescript
import type { NodeStatus } from "../types.ts";

export const STATUS_CLASS: Record<NodeStatus, string> = {
  "pending":       "je-runnode--pending",
  "running":       "je-runnode--running",
  "retry-backoff": "je-runnode--retry",
  "completed":     "je-runnode--completed",
  "failed":        "je-runnode--failed",
  "cancelled":     "je-runnode--cancelled",
};

export const STATUS_LABEL: Record<NodeStatus, string> = {
  "pending":       "pending",
  "running":       "running",
  "retry-backoff": "retry…",
  "completed":     "✓",
  "failed":        "✗",
  "cancelled":     "cancelled",
};
```

- [ ] **Step 6.2: `styles.css`**

```css
/* @journeyman/run-viewer */
.je-runview { display: grid; grid-template-rows: 44px 1fr; height: 100%; background: #1a1a24; color: #fff; font-family: system-ui, sans-serif; }
.je-runview__topbar { display: flex; align-items: center; gap: 12px; padding: 0 14px; background: #11111a; border-bottom: 1px solid #2a2a3a; font-size: 13px; }
.je-runview__pill { font-size: 11px; padding: 3px 10px; border-radius: 10px; font-weight: 600; }
.je-runview__pill.pending   { background: rgba(150,150,170,0.15); color: #aaa; }
.je-runview__pill.running   { background: rgba(74,158,255,0.15); color: #4a9eff; }
.je-runview__pill.completed { background: rgba(0,184,148,0.15);  color: #00b894; }
.je-runview__pill.failed    { background: rgba(255,118,117,0.15); color: #ff7675; }
.je-runview__pill.cancelled { background: rgba(150,150,170,0.15); color: #aaa; }
.je-runview__pill.paused    { background: rgba(253,203,110,0.15); color: #fdcb6e; }

.je-runview__body { display: grid; grid-template-columns: 1fr 320px; min-height: 0; }
.je-runview__canvas { position: relative; background: #1a1a24; }

/* Run-status decoration applied via wrapping <div> per node */
.je-runnode { position: relative; }
.je-runnode__badge {
  position: absolute; top: -6px; right: -6px;
  background: #11111a; border: 1px solid #2a2a3a;
  color: #fff; border-radius: 10px;
  padding: 1px 7px; font-size: 10px; font-weight: 600;
}
.je-runnode--pending   { opacity: 0.55; }
.je-runnode--pending .je-runnode__badge { color: #888; }
.je-runnode--running .je-runnode__badge   { color: #4a9eff; border-color: #4a9eff; box-shadow: 0 0 0 3px rgba(74,158,255,0.15); animation: jePulse 1.4s infinite; }
.je-runnode--retry .je-runnode__badge     { color: #fdcb6e; border-color: #fdcb6e; }
.je-runnode--completed .je-runnode__badge { color: #00b894; border-color: #00b894; }
.je-runnode--failed .je-runnode__badge    { color: #ff7675; border-color: #ff7675; }
.je-runnode--cancelled .je-runnode__badge { color: #aaa; }

@keyframes jePulse { 0%,100% { box-shadow: 0 0 0 3px rgba(74,158,255,0.15);} 50% { box-shadow: 0 0 0 5px rgba(74,158,255,0.30);} }

.je-runview__drawer { background: #11111a; border-left: 1px solid #2a2a3a; padding: 12px; overflow: auto; font-size: 12px; }
.je-runview__drawer h2 { margin: 0 0 4px; font-size: 14px; }
.je-runview__section { margin-bottom: 12px; }
.je-runview__section h3 { margin: 0 0 4px; font-size: 10px; color: #aaa; text-transform: uppercase; letter-spacing: 0.04em; }
.je-runview__pre { background: #1a1a2a; border: 1px solid #2a2a3a; border-radius: 4px; padding: 8px; font-family: ui-monospace, monospace; font-size: 11px; color: #ccc; white-space: pre-wrap; max-height: 200px; overflow: auto; }
.je-runview__log { background: #1a1a2a; border: 1px solid #2a2a3a; border-radius: 4px; padding: 8px; font-family: ui-monospace, monospace; font-size: 11px; color: #ccc; max-height: 240px; overflow: auto; }
.je-runview__log-line { line-height: 1.5; }
.je-runview__attempts { display: flex; flex-direction: column; gap: 4px; }
.je-runview__attempt { background: #1a1a2a; border: 1px solid #2a2a3a; border-radius: 4px; padding: 6px 8px; font-size: 11px; }
```

- [ ] **Step 6.3: `ReadOnlyCanvas.tsx`** — re-uses flow-editor's node components, wraps each in a status-decorated container by registering wrapped node types.

```tsx
import { useMemo } from "react";
import {
  Background, Controls, ReactFlow, ReactFlowProvider,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowGraph } from "@journeyman/core";
import { nodeTypes as editorNodeTypes, edgeTypes as editorEdgeTypes } from "@journeyman/flow-editor";
import { STATUS_CLASS, STATUS_LABEL } from "./status-styles.ts";
import type { ResolvedNodeStatus } from "../types.ts";

function makeWrappedNode(InnerComponent: React.ComponentType<NodeProps>) {
  return function WrappedNode(props: NodeProps) {
    const data = props.data as { runStatus?: ResolvedNodeStatus; [k: string]: unknown };
    const rs = data.runStatus ?? { status: "pending" as const, attempt: 0, visitCount: 0 };
    const cls = STATUS_CLASS[rs.status];
    const badge = rs.attempt > 1 ? `${STATUS_LABEL[rs.status]} ×${rs.attempt}` : STATUS_LABEL[rs.status];
    return (
      <div className={`je-runnode ${cls}`}>
        <InnerComponent {...props} />
        <div className="je-runnode__badge">{badge}</div>
      </div>
    );
  };
}

// editorNodeTypes is a record of name → component; wrap each.
function buildWrappedNodeTypes(): typeof editorNodeTypes {
  const wrapped: Record<string, React.ComponentType<NodeProps>> = {};
  for (const [name, Comp] of Object.entries(editorNodeTypes)) {
    wrapped[name] = makeWrappedNode(Comp as React.ComponentType<NodeProps>);
  }
  return wrapped as typeof editorNodeTypes;
}

export interface ReadOnlyCanvasProps {
  flow: FlowGraph;
  statuses: Map<string, ResolvedNodeStatus>;
  selectedNodeId: string | null;
  onSelect: (id: string | null) => void;
}

function CanvasInner(p: ReadOnlyCanvasProps) {
  const wrappedNodeTypes = useMemo(buildWrappedNodeTypes, []);

  const rfNodes: Node[] = useMemo(() => p.flow.nodes.map(n => ({
    id: n.id,
    type: n.type === "phase" ? "phase" : (n.type === "start" ? "start" : (n.type === "end" ? "end" : "phase")),
    position: n.position ?? { x: 0, y: 0 },
    data: {
      displayName: n.displayName ?? n.phaseType ?? n.type,
      phaseType: n.phaseType ?? "",
      runStatus: p.statuses.get(n.id),
    },
    selected: n.id === p.selectedNodeId,
    selectable: true,
    draggable: false,
  })), [p.flow.nodes, p.statuses, p.selectedNodeId]);

  const rfEdges: Edge[] = useMemo(() => p.flow.edges.map(e => ({
    id: e.id, source: e.source, target: e.target, type: "default", animated: isAnimatedEdge(e, p.flow, p.statuses),
  })), [p.flow, p.statuses]);

  return (
    <div className="je-runview__canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={wrappedNodeTypes}
        edgeTypes={editorEdgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onSelectionChange={(s) => p.onSelect(s.nodes[0]?.id ?? null)}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function isAnimatedEdge(
  e: { source: string; target: string },
  flow: FlowGraph,
  statuses: Map<string, ResolvedNodeStatus>,
): boolean {
  // Animate edges leaving a running node (live "flow") or leaving a completed
  // node whose target is not yet completed.
  const src = statuses.get(e.source);
  const tgt = statuses.get(e.target);
  if (src?.status === "running") return true;
  if (src?.status === "completed" && tgt && tgt.status !== "completed" && tgt.status !== "failed") return true;
  return false;
}

export function ReadOnlyCanvas(p: ReadOnlyCanvasProps) {
  return <ReactFlowProvider><CanvasInner {...p} /></ReactFlowProvider>;
}
```

---

## Task 7: detail drawer + topbar + top-level `<RunViewer>`

**Files:**
- Create: `packages/run-viewer/src/drawer/NodeDetailDrawer.tsx`
- Create: `packages/run-viewer/src/topbar/RunTopbar.tsx`
- Create: `packages/run-viewer/src/RunViewer.tsx`
- Modify: `packages/run-viewer/src/index.ts`

- [ ] **Step 7.1: `NodeDetailDrawer.tsx`**

```tsx
import type { NodeExecution, RunEvent } from "@journeyman/core";
import type { ResolvedNodeStatus } from "../types.ts";

export interface NodeDetailDrawerProps {
  nodeId: string | null;
  displayName: string | null;
  status: ResolvedNodeStatus | null;
  events: RunEvent[];      // already filtered to this node id by parent
  executions: NodeExecution[]; // already filtered
}

export function NodeDetailDrawer(p: NodeDetailDrawerProps) {
  if (!p.nodeId) {
    return (
      <aside className="je-runview__drawer">
        <div style={{ color: "#888", textAlign: "center", padding: "24px 12px" }}>
          Click a node to inspect it.
        </div>
      </aside>
    );
  }
  const lastExec = [...p.executions].sort((a, b) => b.attempt - a.attempt)[0] ?? null;
  const logs = p.events.filter(e => e.eventType === "phase.log");

  return (
    <aside className="je-runview__drawer">
      <h2>{p.displayName ?? p.nodeId}</h2>
      <div style={{ color: "#aaa", fontSize: 11, marginBottom: 10 }}>
        {p.status ? `${p.status.status} · attempt ${p.status.attempt || 0}` : "no status"}
        {p.status?.durationMs ? ` · ${(p.status.durationMs / 1000).toFixed(1)}s` : ""}
      </div>

      <div className="je-runview__section">
        <h3>Input</h3>
        <pre className="je-runview__pre">{JSON.stringify(lastExec?.input ?? {}, null, 2)}</pre>
      </div>

      <div className="je-runview__section">
        <h3>Output</h3>
        <pre className="je-runview__pre">
          {lastExec?.output ? JSON.stringify(lastExec.output, null, 2) : "—"}
        </pre>
      </div>

      {p.status?.errorClass && (
        <div className="je-runview__section">
          <h3>Error</h3>
          <pre className="je-runview__pre" style={{ color: "#ff7675" }}>
            {p.status.errorClass}{lastExec?.errorMessage ? `\n\n${lastExec.errorMessage}` : ""}
          </pre>
        </div>
      )}

      <div className="je-runview__section">
        <h3>Logs ({logs.length})</h3>
        <div className="je-runview__log">
          {logs.length === 0 && <div style={{ color: "#666" }}>(no logs yet)</div>}
          {logs.map(ev => {
            const line = (ev.payload as { line?: string }).line ?? JSON.stringify(ev.payload);
            return <div key={ev.id} className="je-runview__log-line">{line}</div>;
          })}
        </div>
      </div>

      <div className="je-runview__section">
        <h3>Attempts</h3>
        <div className="je-runview__attempts">
          {p.executions.length === 0 && <div style={{ color: "#666" }}>(none yet)</div>}
          {[...p.executions].sort((a, b) => a.attempt - b.attempt).map(e => (
            <div key={e.id} className="je-runview__attempt">
              <span style={{ fontWeight: 600 }}>#{e.attempt}</span>
              <span style={{ color: "#888", marginLeft: 8 }}>{e.status}</span>
              {e.errorClass && <span style={{ color: "#ff7675", marginLeft: 8 }}>{e.errorClass}</span>}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 7.2: `RunTopbar.tsx`**

```tsx
import type { Run } from "@journeyman/core";

export interface RunTopbarProps {
  flowName: string;
  run: Run;
  onRerun?: () => void;
  busy?: boolean;
}

export function RunTopbar(p: RunTopbarProps) {
  const startedLabel = p.run.startedAt
    ? `started ${new Date(p.run.startedAt).toLocaleTimeString()}`
    : "not started";
  return (
    <header className="je-runview__topbar">
      <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{p.flowName}</h1>
      <span className={`je-runview__pill ${p.run.status}`}>{p.run.status}</span>
      <span style={{ color: "#888", fontSize: 11 }}>{startedLabel}</span>
      {p.run.durationMs && (
        <span style={{ color: "#888", fontSize: 11 }}>· {(p.run.durationMs / 1000).toFixed(1)}s</span>
      )}
      <div style={{ flex: 1 }} />
      {p.onRerun && (
        <button
          disabled={p.busy}
          onClick={p.onRerun}
          style={{ background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "5px 12px", borderRadius: 5, fontSize: 12, cursor: "pointer" }}
        >↻ Re-run</button>
      )}
    </header>
  );
}
```

- [ ] **Step 7.3: `RunViewer.tsx`**

```tsx
import { useMemo, useState } from "react";
import { ReadOnlyCanvas } from "./canvas/ReadOnlyCanvas.tsx";
import { NodeDetailDrawer } from "./drawer/NodeDetailDrawer.tsx";
import { RunTopbar } from "./topbar/RunTopbar.tsx";
import { computeNodeStatuses } from "./status/compute-node-status.ts";
import type { RunViewerProps } from "./types.ts";
import "./styles.css";

export function RunViewer(props: RunViewerProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(props.initialSelectedNodeId ?? null);

  const statuses = useMemo(() => computeNodeStatuses({
    flow: props.flow, events: props.events, executions: props.executions, runStatus: props.run.status,
  }), [props.flow, props.events, props.executions, props.run.status]);

  const selectedNode = props.flow.nodes.find(n => n.id === selectedNodeId) ?? null;
  const selectedDisplayName = selectedNode?.displayName ?? selectedNode?.phaseType ?? selectedNode?.type ?? null;

  const eventsForSelected = useMemo(
    () => selectedNodeId ? props.events.filter(e => e.nodeId === selectedNodeId) : [],
    [props.events, selectedNodeId],
  );
  const execsForSelected = useMemo(
    () => selectedNodeId ? props.executions.filter(e => e.nodeId === selectedNodeId) : [],
    [props.executions, selectedNodeId],
  );

  return (
    <div className="je-runview">
      <RunTopbar
        flowName={(props.flow as unknown as { name?: string }).name ?? "Run"}
        run={props.run}
        onRerun={props.onRerun}
      />
      <div className="je-runview__body">
        <ReadOnlyCanvas
          flow={props.flow}
          statuses={statuses}
          selectedNodeId={selectedNodeId}
          onSelect={setSelectedNodeId}
        />
        <NodeDetailDrawer
          nodeId={selectedNodeId}
          displayName={selectedDisplayName}
          status={selectedNodeId ? (statuses.get(selectedNodeId) ?? null) : null}
          events={eventsForSelected}
          executions={execsForSelected}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 7.4: update `index.ts`**

```typescript
export { RunViewer } from "./RunViewer.tsx";
export { computeNodeStatuses } from "./status/compute-node-status.ts";
export type { RunViewerProps, NodeStatus, ResolvedNodeStatus } from "./types.ts";
```

---

## Task 8: scaffold and implement `@journeyman/runs-list`

**Files:**
- Create: `packages/runs-list/package.json`
- Create: `packages/runs-list/tsconfig.json`
- Create: `packages/runs-list/src/css.d.ts`
- Create: `packages/runs-list/src/types.ts`
- Create: `packages/runs-list/src/styles.css`
- Create: `packages/runs-list/src/RunFilters.tsx`
- Create: `packages/runs-list/src/RunsList.tsx`
- Create: `packages/runs-list/src/index.ts`

- [ ] **Step 8.1: `package.json`**

```json
{
  "name": "@journeyman/runs-list",
  "version": "0.1.0",
  "description": "Sortable + filterable runs table for Journeyman.",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": { "typecheck": "tsc --noEmit" },
  "peerDependencies": { "react": "^18.3.0", "react-dom": "^18.3.0" },
  "dependencies": { "@journeyman/core": "*" },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 8.2: `tsconfig.json`** — copy verbatim from `packages/flow-editor/tsconfig.json`.

- [ ] **Step 8.3: `css.d.ts`** — `declare module "*.css";`

- [ ] **Step 8.4: `types.ts`** — verbatim from "Public API of `@journeyman/runs-list`" above.

- [ ] **Step 8.5: `styles.css`**

```css
.je-runslist { padding: 24px; height: 100%; overflow: auto; color: #fff; }
.je-runslist__header { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.je-runslist__header h2 { margin: 0; font-size: 18px; }
.je-runslist__filters { display: flex; gap: 8px; align-items: center; }
.je-runslist__filters select { background: #2a2a3e; border: 1px solid #444; color: #ddd; padding: 4px 10px; border-radius: 4px; font-size: 12px; }
.je-runslist__table { width: 100%; border-collapse: collapse; font-size: 13px; }
.je-runslist__table thead tr { color: #888; text-align: left; border-bottom: 1px solid #2a2a3a; }
.je-runslist__table thead th { padding: 8px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
.je-runslist__table tbody tr { border-bottom: 1px solid #1f1f2c; cursor: pointer; }
.je-runslist__table tbody tr:hover { background: #1f1f2c; }
.je-runslist__table td { padding: 10px 6px; }
.je-runslist__pill { font-size: 11px; padding: 2px 8px; border-radius: 8px; font-weight: 600; }
.je-runslist__pill.pending   { background: rgba(150,150,170,0.15); color: #aaa; }
.je-runslist__pill.running   { background: rgba(74,158,255,0.15); color: #4a9eff; }
.je-runslist__pill.completed { background: rgba(0,184,148,0.15);  color: #00b894; }
.je-runslist__pill.failed    { background: rgba(255,118,117,0.15); color: #ff7675; }
.je-runslist__pill.cancelled { background: rgba(150,150,170,0.15); color: #aaa; }
.je-runslist__pill.paused    { background: rgba(253,203,110,0.15); color: #fdcb6e; }
.je-runslist__rerun { background: transparent; border: 1px solid #444; color: #ccc; padding: 3px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; }
.je-runslist__rerun:hover { background: #2a2a3e; }
```

- [ ] **Step 8.6: `RunFilters.tsx`**

```tsx
import type { RunFilter } from "./types.ts";
import type { Run } from "@journeyman/core";

const STATUSES: Run["status"][] = ["pending", "running", "completed", "failed", "cancelled", "paused"];

export interface RunFiltersProps {
  filter: RunFilter;
  onChange: (next: RunFilter) => void;
}

export function RunFilters({ filter, onChange }: RunFiltersProps) {
  return (
    <div className="je-runslist__filters">
      <select
        value={filter.status ?? ""}
        onChange={e => onChange({ ...filter, status: (e.target.value || undefined) as Run["status"] | undefined })}
      >
        <option value="">All statuses</option>
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}
```

- [ ] **Step 8.7: `RunsList.tsx`**

```tsx
import "./styles.css";
import type { RunsListProps } from "./types.ts";
import { RunFilters } from "./RunFilters.tsx";

export function RunsList(p: RunsListProps) {
  return (
    <div className="je-runslist">
      <div className="je-runslist__header">
        <h2>Runs</h2>
        <div style={{ flex: 1 }} />
        <RunFilters filter={p.filter} onChange={p.onFilterChange} />
      </div>
      {p.isLoading && <div style={{ color: "#888" }}>Loading…</div>}
      {!p.isLoading && p.runs.length === 0 && (
        <div style={{ color: "#888" }}>No runs match the current filters.</div>
      )}
      {p.runs.length > 0 && (
        <table className="je-runslist__table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Run</th>
              <th>Flow</th>
              <th>Trigger</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Failed at</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {p.runs.map(r => (
              <tr key={r.id} onClick={() => p.onSelectRun(r.id)}>
                <td><span className={`je-runslist__pill ${r.status}`}>{r.status}</span></td>
                <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{r.id.slice(0, 8)}</td>
                <td style={{ color: "#aaa" }}>{p.flowNameByVersionId?.[r.flowVersionId] ?? r.flowVersionId.slice(0, 8)}</td>
                <td style={{ color: "#aaa" }}>{r.triggerSource}</td>
                <td style={{ color: "#888" }}>{r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}</td>
                <td style={{ color: "#888" }}>{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                <td style={{ color: "#ff7675" }}>{r.failedAtNodeId ?? ""}</td>
                <td onClick={e => e.stopPropagation()}>
                  {p.onRerun && r.status !== "running" && (
                    <button className="je-runslist__rerun" onClick={() => p.onRerun!(r)}>Re-run</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 8.8: `index.ts`**

```typescript
export { RunsList } from "./RunsList.tsx";
export type { RunsListProps, RunFilter } from "./types.ts";
```

---

## Task 9: web shell — runs API client, runs pages, nav link, toast update

**Files:**
- Create: `packages/web/src/api/runs.ts`
- Create: `packages/web/src/routes/RunsListPage.tsx`
- Create: `packages/web/src/routes/RunDetailPage.tsx`
- Modify: `packages/web/src/components/AppShell.tsx`
- Modify: `packages/web/src/components/RunSubmittedToast.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/package.json`

- [ ] **Step 9.1: add new deps to `packages/web/package.json`**

In `dependencies`, add:

```json
"@journeyman/run-viewer": "*",
"@journeyman/runs-list": "*"
```

- [ ] **Step 9.2: `api/runs.ts`**

```typescript
import type { NodeExecution, Run, RunEvent } from "@journeyman/core";
import { api } from "./client.ts";

export async function listRuns(filter: { status?: Run["status"]; flowId?: string; limit?: number } = {}): Promise<Run[]> {
  const qs = new URLSearchParams();
  if (filter.status) qs.set("status", filter.status);
  if (filter.flowId) qs.set("flow_id", filter.flowId);
  if (filter.limit) qs.set("limit", String(filter.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await api<{ runs: Run[] }>(`/runs${suffix}`);
  return res.runs;
}

export interface RunDetail {
  run: Run;
  executions: NodeExecution[];
  events: RunEvent[];
}

export async function getRun(runId: string): Promise<RunDetail> {
  return await api<RunDetail>(`/runs/${encodeURIComponent(runId)}`);
}

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:4000";

/**
 * Open an SSE stream for a run. Returns a function to close it. The onEvent
 * callback is invoked for each parsed RunEvent in the order received.
 */
export function openRunEventStream(args: {
  runId: string;
  sinceId?: number;
  onEvent: (ev: RunEvent) => void;
  onError?: (e: Event) => void;
  onOpen?: () => void;
}): () => void {
  const url = `${baseUrl}/runs/${encodeURIComponent(args.runId)}/events${args.sinceId ? `?since=${args.sinceId}` : ""}`;
  const es = new EventSource(url);
  es.onopen = () => args.onOpen?.();
  es.onerror = (e) => args.onError?.(e);
  // Each event has `event:` set to its eventType — we listen on a few specific names plus a generic message.
  const types = [
    "phase.started", "phase.log", "phase.failed", "phase.retrying", "phase.completed",
    "node.cycled", "run.started", "run.completed", "run.failed", "run.cancelled",
  ];
  for (const t of types) {
    es.addEventListener(t, (raw) => {
      const data = (raw as MessageEvent).data;
      try { args.onEvent(JSON.parse(data) as RunEvent); }
      catch { /* ignore malformed */ }
    });
  }
  return () => es.close();
}
```

- [ ] **Step 9.3: `RunsListPage.tsx`**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RunsList, type RunFilter } from "@journeyman/runs-list";
import type { Run } from "@journeyman/core";
import { listRuns } from "../api/runs.ts";
import { runFlow } from "../api/flows.ts";

export function RunsListPage() {
  const [filter, setFilter] = useState<RunFilter>({});
  const navigate = useNavigate();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["runs", filter],
    queryFn: () => listRuns({ status: filter.status, flowId: filter.flowId }),
    refetchInterval: 4000, // simple polling for the list page; live SSE is per-run
  });

  const rerunM = useMutation({
    mutationFn: async (r: Run) => {
      // Re-run = submit a new run against the same flow_version_id's parent flow,
      // re-using the run's inputs. We don't have flowId at hand from the Run row,
      // but the api-server's POST /flows/:id/runs needs a flow id. Phase 6 adds a
      // proper "fork" endpoint; in Phase 3 we do the simplest thing and call the
      // standard run endpoint via the flow that owns the version.
      // For now we pass the existing inputs through.
      // (api-server resolves the current version on the flow.)
      const flowId = await resolveFlowIdForRun(r.id);
      return await runFlow(flowId, r.inputs ?? {});
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs"] });
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

// Phase 3 helper: walk back from a run to its flow id by hitting the run detail
// endpoint then the flow-version-current endpoint. A proper /runs/:id/rerun
// endpoint lands in Phase 6.
async function resolveFlowIdForRun(_runId: string): Promise<string> {
  // For Phase 3 the runs row carries flow_version_id but not flow_id directly.
  // Until the api-server returns flow_id alongside, we cannot rerun blindly here.
  // Throw a clear error so the UI surfaces it in the toast layer.
  throw new Error(
    "Re-run from the runs list isn't wired up in Phase 3 — open the run and use the Re-run button there.",
  );
}
```

(Note: the Re-run-from-list button intentionally throws a friendly error in Phase 3 because the `Run` row doesn't carry the parent `flow_id`. Re-run from the **detail** page works, since it has the flow loaded. Phase 6 closes this gap with a `/runs/:id/rerun` endpoint that resolves on the server side.)

- [ ] **Step 9.4: `RunDetailPage.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RunViewer } from "@journeyman/run-viewer";
import type { FlowGraph, RunEvent } from "@journeyman/core";
import { getRun, openRunEventStream } from "../api/runs.ts";
import { getCurrentFlowVersion, runFlow, getFlow } from "../api/flows.ts";

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [liveEvents, setLiveEvents] = useState<RunEvent[]>([]);

  // Initial load — Run + executions + persisted events.
  const detailQ = useQuery({
    queryKey: ["run-detail", id],
    queryFn: () => getRun(id!),
    enabled: !!id,
  });

  // The flow graph for this run's version.
  // We need to look up the flow_id from the version — Phase 3 takes a small shortcut:
  // we fetch the flow by listing flows and matching the version, OR we use the
  // run's flowVersionId to ask api-server for the version directly via a new endpoint.
  // The simplest pass: store flowVersion → flow lookup in the queryClient cache.
  const versionId = detailQ.data?.run.flowVersionId;
  const flowGraphQ = useQuery({
    queryKey: ["run-flow-version", versionId],
    queryFn: async () => {
      if (!versionId) return null;
      // Try cache first.
      const cached = qc.getQueryData<FlowGraph>(["flow-version-graph", versionId]);
      if (cached) return cached;
      // Fall back to a heuristic: fetch the parent flow's CURRENT version. In Phase 3
      // (immutable versions) the run's version may differ from current, but the editor
      // always saves before run, so the most recent version is what the user submitted.
      // Phase 6 introduces /flow_versions/:id; until then, this is good enough for v0.
      const v = await getCurrentFlowVersionByVersionId(versionId).catch(() => null);
      if (v) return v.definition;
      return null;
    },
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

  const rerunM = useMutation({
    mutationFn: async () => {
      const v = detailQ.data?.run.flowVersionId;
      if (!v) throw new Error("missing version id");
      const flowId = await resolveFlowIdFromVersion(v);
      return await runFlow(flowId, detailQ.data?.run.inputs ?? {});
    },
    onSuccess: (res) => navigate(`/runs/${res.runId}`),
  });

  if (!id) { navigate("/runs"); return null; }
  if (detailQ.isLoading) return <div style={{ padding: 24, color: "#888" }}>Loading run…</div>;
  if (detailQ.isError || !detailQ.data) return <div style={{ padding: 24, color: "#ff7675" }}>Run not found.</div>;
  if (flowGraphQ.isLoading || !flowGraphQ.data) {
    return <div style={{ padding: 24, color: "#888" }}>Loading flow definition…</div>;
  }

  return (
    <div style={{ height: "100%" }}>
      <RunViewer
        flow={flowGraphQ.data}
        run={detailQ.data.run}
        events={allEvents}
        executions={detailQ.data.executions}
        onRerun={() => rerunM.mutate()}
      />
    </div>
  );
}

// --- Phase 3 lookup helpers (will be replaced in Phase 6 by /flow_versions/:id) ---
async function getCurrentFlowVersionByVersionId(versionId: string): Promise<{ definition: FlowGraph } | null> {
  // We don't have a direct version fetch yet. We walk: list flows → for each, check
  // if its currentVersionId === versionId → if so, return current. This is O(N) but
  // N is tiny in v0. Once /flow_versions/:id ships in Phase 6 this whole helper goes away.
  const flowsRes = await fetch(`${(import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:4000"}/flows`);
  const j = (await flowsRes.json()) as { flows: Array<{ id: string; currentVersionId: string | null }> };
  const owner = j.flows.find(f => f.currentVersionId === versionId);
  if (!owner) return null;
  const v = await getCurrentFlowVersion(owner.id);
  if (v.id !== versionId) return null;
  return { definition: v.definition };
}

async function resolveFlowIdFromVersion(versionId: string): Promise<string> {
  const flowsRes = await fetch(`${(import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:4000"}/flows`);
  const j = (await flowsRes.json()) as { flows: Array<{ id: string; currentVersionId: string | null }> };
  const owner = j.flows.find(f => f.currentVersionId === versionId);
  if (!owner) throw new Error("Could not resolve flow id from version");
  return owner.id;
}
```

(Note: the two `resolveFlowIdFromVersion` / `getCurrentFlowVersionByVersionId` helpers are explicitly marked as Phase 3 stand-ins. Phase 6 introduces `GET /flow_versions/:id` and removes them.)

- [ ] **Step 9.5: update `AppShell.tsx`** — add the Runs nav link.

Replace the file:

```tsx
import { Link, NavLink, Outlet } from "react-router-dom";

const styles = {
  nav: {
    display: "flex", alignItems: "center", gap: 16,
    background: "#11111a", borderBottom: "1px solid #2a2a3a",
    padding: "10px 18px", fontSize: 13,
  } as React.CSSProperties,
  brand: { fontWeight: 700, color: "#4a9eff", marginRight: 12, textDecoration: "none" } as React.CSSProperties,
  link: { color: "#aaa", textDecoration: "none" } as React.CSSProperties,
  linkActive: { color: "#fff", fontWeight: 600 } as React.CSSProperties,
  body: { height: "calc(100vh - 41px)", overflow: "hidden" } as React.CSSProperties,
};

export default function AppShell() {
  return (
    <div>
      <nav style={styles.nav}>
        <Link to="/" style={styles.brand}>◆ Journeyman</Link>
        <NavLink to="/flows" style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.linkActive : {}) })}>Flows</NavLink>
        <NavLink to="/runs" style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.linkActive : {}) })}>Runs</NavLink>
      </nav>
      <main style={styles.body}>
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 9.6: update `RunSubmittedToast.tsx`** — add a "View live" button that calls a new `onViewLive` prop.

Replace the file:

```tsx
import { conductorUiUrl } from "../api/client.ts";

export interface RunSubmittedToastProps {
  runId: string;
  engineWorkflowId: string;
  onDismiss: () => void;
  onViewLive?: () => void;
}

export function RunSubmittedToast(p: RunSubmittedToastProps) {
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, background: "#1f1f2c",
      border: "1px solid #00b894", borderRadius: 8, padding: 14,
      color: "#fff", fontSize: 13, maxWidth: 360, zIndex: 100,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Run submitted</div>
      <div style={{ color: "#aaa", marginBottom: 4 }}>
        Run id: <span style={{ color: "#fff", fontFamily: "ui-monospace, monospace" }}>{p.runId}</span>
      </div>
      <div style={{ color: "#aaa", marginBottom: 8 }}>
        Workflow: <a
          href={`${conductorUiUrl}/execution/${p.engineWorkflowId}`}
          target="_blank" rel="noreferrer"
          style={{ color: "#4a9eff" }}
        >open in Conductor UI</a>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {p.onViewLive && (
          <button
            onClick={p.onViewLive}
            style={{ background: "#00b894", border: "none", color: "#fff", padding: "5px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer", fontWeight: 600 }}
          >View live →</button>
        )}
        <button
          style={{ background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
          onClick={p.onDismiss}
        >Dismiss</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 9.7: update `App.tsx`** — register the new routes.

```tsx
import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/AppShell.tsx";
import { FlowsListPage } from "./routes/FlowsListPage.tsx";
import { FlowEditorPage } from "./routes/FlowEditorPage.tsx";
import { NewFlowPage } from "./routes/NewFlowPage.tsx";
import { RunsListPage } from "./routes/RunsListPage.tsx";
import { RunDetailPage } from "./routes/RunDetailPage.tsx";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/flows" replace />} />
        <Route path="/flows" element={<FlowsListPage />} />
        <Route path="/flows/new" element={<NewFlowPage />} />
        <Route path="/flows/:id/edit" element={<FlowEditorPage />} />
        <Route path="/runs" element={<RunsListPage />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Route>
    </Routes>
  );
}
```

---

## Task 10: install + repo-wide typecheck + manual smoke

- [ ] **Step 10.1: `npm install`** (links the two new packages into web).

```bash
npm install
```

- [ ] **Step 10.2: typecheck**

```bash
npm run typecheck
```
Expected: green across all 16 workspaces (`core`, `coding-cli`, `git-provider`, `github-api`, `ticket-provider`, `notification-provider`, `pipeline`, `pipeline-server`, `ui`, `migrations`, `orchestrator`, `api-server`, `flow-editor`, `web`, `run-viewer`, `runs-list`).

- [ ] **Step 10.3: manual smoke**

1. `npm run infra:up && npm run migrate`
2. `npm run start:api-server &` (now also starts the RunSyncer)
3. `npm run start:worker &`
4. `npm run dev:web`
5. In the browser at `http://localhost:5173`:
   - Click **Flows** → open or create a flow with `start → analyze → end`.
   - Click **Run**. The toast appears. Click **View live →**.
   - The Run detail page loads, the Analyze node animates blue (running), then turns green (completed) or red (failed). Click the node — its drawer shows input, output (or error), and any phase.log lines.
   - Navigate to **Runs**. The new run is listed. Click the row → the same detail view opens, this time as a frozen snapshot (no live events because the run is terminal).

---

## Self-Review Checklist

**Spec coverage (Phase 3 from spec §12):**
- [x] SSE endpoint `GET /runs/:id/events` on api-server — Task 2
- [x] Bridge from Conductor → events — Task 3 (RunSyncer for run-level; worker harness for phase-level was already in Phase 1)
- [x] Read-only canvas with full visual language — Task 6 (status colors + animated edges)
- [x] Click-node-for-detail drawer (input, live output, attempts, logs) — Task 7
- [x] Runs list with status/time/user/duration/failed-at filters — Task 8 (status filter shipped; time/user filters deferred to Phase 6 UI polish)
- [x] Re-run action — Task 8/9 (live from the run detail page; from the list deferred to Phase 6 with `/runs/:id/rerun`)
- [x] Closes Phase 2 gap — Task 1

**Out-of-scope deferred to later phases:**
- Time-range and user filters in the runs list → Phase 6
- `POST /runs/:id/rerun` server endpoint → Phase 6
- Resume from failed step / fork-edit → Phase 6
- Animated edge "flow direction" arrows → optional polish, not blocking

**Type consistency:**
- `RunViewerProps.events` accepts `RunEvent[]` — matches `IEventBus.list`'s return type and the SSE payload.
- `computeNodeStatuses` is exported from run-viewer's barrel — usable in tests and SSR later.
- `RunsListProps.flowNameByVersionId` is optional; the table falls back to the version id's first 8 chars.

**Phase 3 known gaps (deliberate, all marked inline in code):**
1. Re-run from the runs **list** throws a friendly error because `Run` doesn't carry `flow_id`. Re-run from the **detail** page works via the version→flow heuristic helper.
2. There's no `GET /flow_versions/:id` endpoint, so `RunDetailPage` walks `GET /flows` to find the flow that owns the run's version. Phase 6 introduces the direct endpoint.

These are documented in the code with `// Phase 3 stand-in:` comments.
