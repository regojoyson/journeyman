# Human-Task Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a working `human-task` node to the flow engine that pauses runs, exposes pending state via API + UI, and resumes via provider webhooks (Jira / GitHub / GitLab / Monday) or an in-app form. Branching is by outcome label.

**Architecture:** Reuse the existing Conductor engine via a new `HUMAN` task emission in the converter (Conductor handles the task server-side; our worker harness is unaffected). A new `engine-reconciler` queries Conductor on demand and syncs our DB (`Run.status = paused`, `NodeExecution.status = waiting`, store `conductor_task_id`). Reuse the existing `POST /webhooks/:provider` ingest path with a new "resolve-pending-task" branch keyed on `issueRef`. One internal `resolveHumanTask` function is the single mutation entry point (called by webhook, manual form, and timeout timer); it reads `conductor_task_id` from the NodeExecution row and calls the existing `completeTask` Conductor client method.

**Tech Stack:** TypeScript, npm workspaces monorepo (`@journeyman/core`, `@journeyman/orchestrator`, `@journeyman/api-server`, `@journeyman/flow-editor`), Fastify, Postgres, Netflix Conductor (over HTTP), React.

**Spec:** [docs/superpowers/specs/2026-05-07-human-task-node-design.md](../specs/2026-05-07-human-task-node-design.md)

---

## Workflow Conventions

- **No commits during implementation.** All work stays uncommitted until the user reviews.
- **No unit tests.** Verification is via `npm run typecheck` at the end (final task).
- **Out of scope** (per spec §8): HMAC verification, per-node assignees, notifications, parallel human-tasks, non-issueRef correlation. Do not implement these.

---

## File Map

### Created

| File | Purpose |
|---|---|
| `packages/migrations/src/sql/016_human_tasks.sql` | DB schema: `node_execution_status` accepts `waiting`; add `conductor_task_id` column on `jm_node_executions`; new `jm_human_task_resolutions` table |
| `packages/core/src/types/human-task.types.ts` | `HumanTaskConfig`, `HumanTaskOutcomeMap`, `HumanTaskOutput` types |
| `packages/api-server/src/routes/human-tasks.ts` | `POST /runs/:runId/human-tasks/:nodeId/resolve` (manual resolve) |
| `packages/api-server/src/services/resolve-human-task.ts` | Internal `resolveHumanTask` function — single mutation entry point |
| `packages/api-server/src/services/engine-reconciler.ts` | Queries Conductor for one workflow, syncs `Run.status` / `NodeExecution.status=waiting` / `conductor_task_id` to our DB |
| `packages/api-server/src/services/match-human-tasks.ts` | Webhook → pending-task matcher (issueRef + listensFor + outcomeMap) |
| `packages/api-server/src/services/jsonpath.ts` | Tiny dot-path JSONPath helper used by outcomeMap value/comment extraction |
| `packages/api-server/src/services/human-task-timeout.ts` | In-process timer scheduling + cancellation for `config.timeout` |
| `packages/orchestrator/src/stores/human-task-resolution-store.ts` | DB store interface + Postgres impl for `jm_human_task_resolutions` |
| `packages/flow-editor/src/properties-panel/HumanTaskConfigEditor.tsx` | Properties-panel editor for `human-task` config |
| `packages/flow-editor/src/run-detail/HumanTaskPanel.tsx` | Run-detail side panel for waiting human-tasks |

### Modified

| File | What changes |
|---|---|
| `packages/core/src/types/flow.types.ts` | Re-export `HumanTaskConfig`; remove "reserved" comment from `human-task` |
| `packages/core/src/types/run.types.ts` | Add `"waiting"` to `NodeExecutionStatus`; add `"node.waiting"` and `"node.resolved"` to `RunEventType` |
| `packages/core/src/index.ts` | Re-export `HumanTaskConfig`, `HumanTaskOutput` |
| `packages/orchestrator/src/flow-json/conductor-types.ts` | Add `HumanTask` task shape to `ConductorTaskDef` union |
| `packages/orchestrator/src/flow-json/conductor-converter.ts` | Replace `human-task` `UnsupportedNodeTypeError` with real emission; add validation |
| `packages/orchestrator/src/engines/conductor/conductor-client.ts` | Add `getWorkflowWithTasks(workflowId)` helper (workflow state including IN_PROGRESS HUMAN tasks) |
| `packages/orchestrator/src/stores/postgres/postgres-node-execution-store.ts` | Accept `"waiting"` status; new `markWaiting` / `latestWaitingForRun` / `latestForNode` / `markCompleted` methods; persist `conductor_task_id` |
| `packages/orchestrator/src/stores/postgres/postgres-run-store.ts` | New `findPausedRunsByIssueRef` method |
| `packages/orchestrator/src/stores/memory/memory-node-execution-store.ts` | Mirror the new methods on the memory store |
| `packages/orchestrator/src/stores/memory/memory-run-store.ts` | Mirror `findPausedRunsByIssueRef` |
| `packages/core/src/interfaces/run-store.interface.ts` | Declare `findPausedRunsByIssueRef` |
| `packages/core/src/interfaces/node-execution-store.interface.ts` | Declare `markWaiting` / `latestWaitingForRun` / `latestForNode` / `markCompleted` |
| `packages/api-server/src/composition.ts` | Wire `humanTaskResolutions` store + `humanTaskTimeouts` service |
| `packages/api-server/src/routes/webhooks.ts` | Insert resolve-pending-task branch before new-run path |
| `packages/api-server/src/routes/runs.ts` | Surface `pendingHumanTask` summary on run detail |
| `packages/api-server/src/server.ts` | Register `human-tasks` routes |
| `packages/flow-editor/src/palette/Palette.tsx` | Add `human-task` tile under "Gates" group |
| `packages/flow-editor/src/properties-panel/ConfigTab.tsx` | Dispatch to `HumanTaskConfigEditor` when `node.type === "human-task"` |
| `packages/flow-editor/src/canvas/Canvas.tsx` | Render `waiting` node visual state (pulsing border + hourglass) |
| `packages/flow-editor/src/run-detail/RunDetail.tsx` | Mount `HumanTaskPanel` when run is paused on a human-task |
| `packages/flow-editor/src/run-list/RunListFilters.tsx` | Add "Waiting on humans" filter chip |

---

## Wave 0 — Types & Schema

### Task 1: Add `HumanTaskConfig` and supporting types

**Files:**
- Create: `packages/core/src/types/human-task.types.ts`
- Modify: `packages/core/src/types/flow.types.ts:21-27`
- Modify: `packages/core/src/types/run.types.ts:1-7,35-45,56-62`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/src/types/human-task.types.ts`**

```ts
/**
 * Per-provider mapping from raw webhook payload values to declared outcomes.
 * `valuePath` is a dot-path into the JSON payload; `map` translates the raw
 * value at that path into one of the node's declared outcome labels.
 */
export interface HumanTaskOutcomeMap {
  valuePath: string;
  map: Record<string, string>;
  commentPath?: string;
}

export interface HumanTaskConfig {
  /** Free-form outcome labels. Outgoing edges' branchLabel must be a subset. */
  outcomes: string[];
  /** Shown to the human in the UI / notification. */
  prompt?: string;
  /** Provider event filter — only events matching these types resolve the task. */
  listensFor?: string[];
  /** Per-provider extraction config keyed by webhook provider name. */
  outcomeMap?: Record<string, HumanTaskOutcomeMap>;
  /** Optional auto-resolve. Off by default. */
  timeout?: { duration: string; onTimeout: string };
}

export type HumanTaskSource = "webhook" | "manual" | "timeout";

export interface HumanTaskOutput {
  outcome: string;
  comment: string | null;
  actor: string | null;
  source: HumanTaskSource;
  resolvedAt: string;
}
```

- [ ] **Step 2: Update `flow.types.ts` to drop the "reserved" comment**

In `packages/core/src/types/flow.types.ts`, replace lines 17-27 (the `FlowNodeType` block) with:

```ts
export type FlowNodeType =
  | "start"
  | "end"
  | "phase"
  | "human-task"
  // node types reserved for later phases — listed so the converter can reject
  // them in Phase 1 with a clear "not yet supported" error.
  | "gateway-xor"
  | "gateway-and"
  | "loop"
  | "subflow"
  | "if"
  | "timer"
  | "retry-block"
  | "try-catch";
```

- [ ] **Step 3: Add `waiting` to `NodeExecutionStatus` and new run event types**

In `packages/core/src/types/run.types.ts`:

Replace lines 1-7 (the `RunStatus` union — leave unchanged, just verify it still has `"paused"`). Then replace `RunEventType` (lines 35-45):

```ts
export type RunEventType =
  | "phase.started"
  | "phase.log"
  | "phase.failed"
  | "phase.retrying"
  | "phase.completed"
  | "node.cycled"
  | "node.waiting"
  | "node.resolved"
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "run.cancelled";
```

And replace `NodeExecutionStatus` (lines 56-62):

```ts
export type NodeExecutionStatus =
  | "pending"
  | "running"
  | "retrying"
  | "waiting"
  | "completed"
  | "failed"
  | "skipped";
```

- [ ] **Step 4: Re-export from `packages/core/src/index.ts`**

Add to existing export list:

```ts
export type {
  HumanTaskConfig,
  HumanTaskOutcomeMap,
  HumanTaskOutput,
  HumanTaskSource,
} from "./types/human-task.types.ts";
```

---

### Task 2: DB migration `016_human_tasks.sql`

**Files:**
- Create: `packages/migrations/src/sql/016_human_tasks.sql`

- [ ] **Step 1: Inspect prior migration to copy conventions**

Run: `ls packages/migrations/src/sql/ | tail -5` and `cat packages/migrations/src/sql/015_flow_status.sql` so the new file matches the existing style (transaction wrapper, comment header).

- [ ] **Step 2: Write the migration**

Create `packages/migrations/src/sql/016_human_tasks.sql`:

```sql
-- 016_human_tasks.sql
-- Adds the "waiting" node-execution status, conductor_task_id column,
-- and the human-task resolutions audit table.

BEGIN;

-- Drop and recreate the check constraint to include 'waiting'.
-- (Constraint name follows the convention used in earlier migrations; adjust
-- below if your live schema uses a different one — verify with
--   \d jm_node_executions
-- before applying.)
ALTER TABLE jm_node_executions
  DROP CONSTRAINT IF EXISTS jm_node_executions_status_check;

ALTER TABLE jm_node_executions
  ADD CONSTRAINT jm_node_executions_status_check
  CHECK (status IN ('pending','running','retrying','waiting','completed','failed','skipped'));

-- Conductor's task id for an externally-completed HUMAN task. Populated by the
-- engine reconciler when it observes an IN_PROGRESS HUMAN task; consumed by
-- resolveHumanTask when calling Conductor's completeTask endpoint.
ALTER TABLE jm_node_executions
  ADD COLUMN IF NOT EXISTS conductor_task_id text NULL;

CREATE TABLE jm_human_task_resolutions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL REFERENCES jm_runs(id) ON DELETE CASCADE,
  node_id             text NOT NULL,
  outcome             text NOT NULL,
  comment             text NULL,
  actor               text NULL,
  source              text NOT NULL CHECK (source IN ('webhook','manual','timeout')),
  webhook_event_id    uuid NULL REFERENCES jm_webhook_events(id) ON DELETE SET NULL,
  resolved_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jm_human_task_resolutions_run_node_idx
  ON jm_human_task_resolutions(run_id, node_id);

CREATE INDEX jm_node_executions_waiting_idx
  ON jm_node_executions(run_id) WHERE status = 'waiting';

COMMIT;
```

- [ ] **Step 3: Verify the constraint name**

Run: `grep -rn "jm_node_executions_status_check\|node_executions_status" packages/migrations/src/sql/`

Expected: at least one prior migration referencing the constraint. If the actual constraint name differs, update Step 2's `DROP CONSTRAINT IF EXISTS` to match. If no constraint exists (column is plain `text`), the `DROP` is a no-op — leaving the `ADD CONSTRAINT` statement is still correct.

---

## Wave 1 — Engine Emission

### Task 3: Add `HumanTask` shape to Conductor task union

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-types.ts:50-80`

- [ ] **Step 1: Add the new task shape**

In `packages/orchestrator/src/flow-json/conductor-types.ts`, insert after `WaitTask` (line 55) and before `SubWorkflowTask`:

```ts
export interface HumanTask {
  type: "HUMAN";
  name: string;
  taskReferenceName: string;
  inputParameters: {
    outcomes: string[];
    prompt?: string;
    listensFor?: string[];
    outcomeMap?: Record<string, {
      valuePath: string;
      map: Record<string, string>;
      commentPath?: string;
    }>;
    timeoutDurationMs?: number;
    timeoutOutcome?: string;
  };
}
```

Then update the `ConductorTaskDef` union (currently lines 72-80) to include it:

```ts
export type ConductorTaskDef =
  | SimpleTask
  | SwitchTask
  | ForkJoinTask
  | JoinTask
  | DoWhileTask
  | WaitTask
  | HumanTask
  | SubWorkflowTask
  | TerminateTask;
```

---

### Task 4: Implement `emitHumanTask` in the converter

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts:165-176`
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts` (add new method near `emitSwitch`)

- [ ] **Step 1: Replace the `human-task` rejection with a real case**

In `emitNode` (around line 165-176), replace:

```ts
case "retry-block":
case "try-catch":
case "human-task":   throw new UnsupportedNodeTypeError(node.type);
```

with:

```ts
case "human-task":   return this.emitHumanTask(node);
case "retry-block":
case "try-catch":    throw new UnsupportedNodeTypeError(node.type);
```

- [ ] **Step 2: Add `emitHumanTask` method**

Insert immediately after `emitSwitch` (around line 270 in `conductor-converter.ts`):

```ts
emitHumanTask(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
  const cfg = (node.config ?? {}) as Partial<import("@journeyman/core").HumanTaskConfig>;

  if (!Array.isArray(cfg.outcomes) || cfg.outcomes.length === 0) {
    throw new FlowValidationError(`Human-task '${node.id}' must declare at least one outcome`);
  }
  const outcomeSet = new Set(cfg.outcomes);

  const outs = this.outsOf(node.id);
  if (outs.length === 0) {
    throw new FlowValidationError(`Human-task '${node.id}' has no outgoing edges`);
  }

  const conditional = outs.filter(e => e.type === "conditional");
  if (conditional.length === 0) {
    throw new FlowValidationError(`Human-task '${node.id}' must have conditional outgoing edges keyed by outcome`);
  }

  const seenLabels = new Set<string>();
  for (const e of conditional) {
    if (!e.branchLabel) {
      throw new FlowValidationError(`Edge ${e.id} on human-task '${node.id}' requires a branchLabel`);
    }
    if (!outcomeSet.has(e.branchLabel)) {
      throw new FlowValidationError(
        `Edge ${e.id} on human-task '${node.id}' has branchLabel '${e.branchLabel}' which is not in declared outcomes`,
      );
    }
    if (seenLabels.has(e.branchLabel)) {
      throw new FlowValidationError(`Duplicate branchLabel '${e.branchLabel}' on human-task '${node.id}'`);
    }
    seenLabels.add(e.branchLabel);
  }

  for (const outcome of cfg.outcomes) {
    if (!seenLabels.has(outcome)) {
      throw new FlowValidationError(
        `Human-task '${node.id}' declares outcome '${outcome}' but has no outgoing edge for it`,
      );
    }
  }

  if (cfg.timeout) {
    if (!outcomeSet.has(cfg.timeout.onTimeout)) {
      throw new FlowValidationError(
        `Human-task '${node.id}' timeout.onTimeout '${cfg.timeout.onTimeout}' is not a declared outcome`,
      );
    }
  }

  const branchTargets = outs.map(e => e.target);
  const convergence   = findConvergence(branchTargets, this);
  const stopAt        = convergence ? new Set([convergence]) : undefined;

  const cases: Record<string, ConductorTaskDef[]> = {};
  for (const e of conditional) {
    cases[e.branchLabel!] = this.buildSequence(e.target, stopAt);
  }

  // The HUMAN task pauses until externally completed. The downstream SWITCH
  // routes by the outcome the resolver wrote.
  const human: import("./conductor-types.ts").HumanTask = {
    type: "HUMAN",
    name: `human_${node.id}`,
    taskReferenceName: node.id,
    inputParameters: {
      outcomes: cfg.outcomes,
      ...(cfg.prompt !== undefined ? { prompt: cfg.prompt } : {}),
      ...(cfg.listensFor ? { listensFor: cfg.listensFor } : {}),
      ...(cfg.outcomeMap ? { outcomeMap: cfg.outcomeMap } : {}),
      ...(cfg.timeout ? {
        timeoutDurationMs: parseDurationMs(cfg.timeout.duration),
        timeoutOutcome: cfg.timeout.onTimeout,
      } : {}),
    },
  };

  const switchTask: import("./conductor-types.ts").SwitchTask = {
    type: "SWITCH",
    name: `human_switch_${node.id}`,
    taskReferenceName: `${node.id}_switch`,
    evaluatorType: "value-param",
    expression: "outcome",
    inputParameters: { outcome: `\${${node.id}.output.outcome}` },
    decisionCases: cases,
  };

  return { tasks: [human, switchTask], nextNodeId: convergence };
}
```

- [ ] **Step 3: Add `parseDurationMs` helper at the bottom of the same file**

Append at the end of `conductor-converter.ts` (after the class definition, before any `export` of `findConvergence`):

```ts
function parseDurationMs(input: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)$/.exec(input.trim());
  if (!m) throw new FlowValidationError(`Invalid duration '${input}' — expected e.g. '48h', '30m', '7d'`);
  const n = Number(m[1]);
  switch (m[2]) {
    case "ms": return n;
    case "s":  return n * 1000;
    case "m":  return n * 60_000;
    case "h":  return n * 3_600_000;
    case "d":  return n * 86_400_000;
    default:   throw new FlowValidationError(`Invalid duration unit '${m[2]}'`);
  }
}
```

---

### Task 5: Conductor client helper to read workflow state with tasks

**Files:**
- Modify: `packages/orchestrator/src/engines/conductor/conductor-client.ts`

The existing `completeTask(body)` method (already in the client) takes a `taskId` and is what `resolveHumanTask` calls to externally complete a HUMAN task. We just need a read helper so the engine reconciler can find the `taskId` of any IN_PROGRESS HUMAN task.

- [ ] **Step 1: Add the read helper**

Append to the `ConductorClient` class:

```ts
async getWorkflowWithTasks(workflowId: string): Promise<{
  workflowId: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "PAUSED" | "TIMED_OUT";
  tasks: Array<{
    taskId: string;
    taskType: string;          // "SIMPLE" | "HUMAN" | "SWITCH" | "WAIT" | ...
    referenceTaskName: string; // matches our flow node ID
    status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELED" | "TIMED_OUT" | "SKIPPED";
    inputData?: Record<string, unknown>;
    outputData?: Record<string, unknown>;
  }>;
  output?: Record<string, unknown>;
}> {
  return await this.request(`/workflow/${encodeURIComponent(workflowId)}?includeTasks=true`);
}
```

(The Conductor `GET /workflow/{id}?includeTasks=true` endpoint returns the full execution including all tasks. We use it to find HUMAN tasks with status `IN_PROGRESS`.)

---

## Wave 2 — Resolution Path

### Task 6: `jsonpath` helper

**Files:**
- Create: `packages/api-server/src/services/jsonpath.ts`

- [ ] **Step 1: Write the helper**

```ts
/**
 * Minimal dot-path JSON traversal used for extracting outcome values and
 * comment text from webhook payloads. Supports `a.b.c` and `a.b[0].c`.
 * Returns null if any segment is missing.
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (obj == null) return null;
  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur ?? null;
}

export function getStringByPath(obj: unknown, path: string): string | null {
  const v = getByPath(obj, path);
  return typeof v === "string" ? v : v == null ? null : String(v);
}
```

---

### Task 7: Human-task resolution store

**Files:**
- Create: `packages/orchestrator/src/stores/human-task-resolution-store.ts`

- [ ] **Step 1: Define the interface and Postgres implementation**

```ts
import type { Pool } from "pg";

export interface HumanTaskResolutionRow {
  id: string;
  runId: string;
  nodeId: string;
  outcome: string;
  comment: string | null;
  actor: string | null;
  source: "webhook" | "manual" | "timeout";
  webhookEventId: string | null;
  resolvedAt: Date;
}

export interface IHumanTaskResolutionStore {
  create(input: Omit<HumanTaskResolutionRow, "id" | "resolvedAt">): Promise<HumanTaskResolutionRow>;
  listForRun(runId: string): Promise<HumanTaskResolutionRow[]>;
  latestForNode(runId: string, nodeId: string): Promise<HumanTaskResolutionRow | null>;
}

export class PostgresHumanTaskResolutionStore implements IHumanTaskResolutionStore {
  constructor(private pool: Pool) {}

  async create(input: Omit<HumanTaskResolutionRow, "id" | "resolvedAt">): Promise<HumanTaskResolutionRow> {
    const r = await this.pool.query(
      `INSERT INTO jm_human_task_resolutions
         (run_id, node_id, outcome, comment, actor, source, webhook_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, run_id, node_id, outcome, comment, actor, source, webhook_event_id, resolved_at`,
      [input.runId, input.nodeId, input.outcome, input.comment, input.actor, input.source, input.webhookEventId],
    );
    return rowToObj(r.rows[0]);
  }

  async listForRun(runId: string): Promise<HumanTaskResolutionRow[]> {
    const r = await this.pool.query(
      `SELECT id, run_id, node_id, outcome, comment, actor, source, webhook_event_id, resolved_at
       FROM jm_human_task_resolutions WHERE run_id = $1 ORDER BY resolved_at ASC`,
      [runId],
    );
    return r.rows.map(rowToObj);
  }

  async latestForNode(runId: string, nodeId: string): Promise<HumanTaskResolutionRow | null> {
    const r = await this.pool.query(
      `SELECT id, run_id, node_id, outcome, comment, actor, source, webhook_event_id, resolved_at
       FROM jm_human_task_resolutions WHERE run_id = $1 AND node_id = $2
       ORDER BY resolved_at DESC LIMIT 1`,
      [runId, nodeId],
    );
    return r.rows[0] ? rowToObj(r.rows[0]) : null;
  }
}

export class MemoryHumanTaskResolutionStore implements IHumanTaskResolutionStore {
  private rows: HumanTaskResolutionRow[] = [];
  private nextId = 1;
  async create(input: Omit<HumanTaskResolutionRow, "id" | "resolvedAt">): Promise<HumanTaskResolutionRow> {
    const row: HumanTaskResolutionRow = { id: String(this.nextId++), resolvedAt: new Date(), ...input };
    this.rows.push(row);
    return row;
  }
  async listForRun(runId: string): Promise<HumanTaskResolutionRow[]> {
    return this.rows.filter(r => r.runId === runId).slice().sort((a,b) => +a.resolvedAt - +b.resolvedAt);
  }
  async latestForNode(runId: string, nodeId: string): Promise<HumanTaskResolutionRow | null> {
    const list = this.rows.filter(r => r.runId === runId && r.nodeId === nodeId)
      .sort((a,b) => +b.resolvedAt - +a.resolvedAt);
    return list[0] ?? null;
  }
}

function rowToObj(r: any): HumanTaskResolutionRow {
  return {
    id: r.id,
    runId: r.run_id,
    nodeId: r.node_id,
    outcome: r.outcome,
    comment: r.comment,
    actor: r.actor,
    source: r.source,
    webhookEventId: r.webhook_event_id,
    resolvedAt: r.resolved_at instanceof Date ? r.resolved_at : new Date(r.resolved_at),
  };
}
```

---

### Task 8: Timeout timer service

**Files:**
- Create: `packages/api-server/src/services/human-task-timeout.ts`

- [ ] **Step 1: Write a simple in-process scheduler**

```ts
type TimeoutKey = `${string}:${string}`; // `${runId}:${nodeId}`

export interface HumanTaskTimeoutService {
  schedule(runId: string, nodeId: string, durationMs: number, fire: () => Promise<void>): void;
  cancel(runId: string, nodeId: string): void;
  cancelAllForRun(runId: string): void;
}

export class InMemoryHumanTaskTimeoutService implements HumanTaskTimeoutService {
  private timers = new Map<TimeoutKey, NodeJS.Timeout>();

  schedule(runId: string, nodeId: string, durationMs: number, fire: () => Promise<void>): void {
    const key: TimeoutKey = `${runId}:${nodeId}`;
    this.cancel(runId, nodeId);
    const t = setTimeout(() => {
      this.timers.delete(key);
      fire().catch(err => {
        console.error(`[human-task-timeout] fire failed for ${key}:`, err);
      });
    }, durationMs);
    this.timers.set(key, t);
  }

  cancel(runId: string, nodeId: string): void {
    const key: TimeoutKey = `${runId}:${nodeId}`;
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(key);
    }
  }

  cancelAllForRun(runId: string): void {
    for (const key of [...this.timers.keys()]) {
      if (key.startsWith(`${runId}:`)) {
        clearTimeout(this.timers.get(key)!);
        this.timers.delete(key);
      }
    }
  }
}
```

> **Note:** This is in-process only. Timers don't survive a server restart. Document this limitation in the spec's "Risks" section if not already there. A persistent scheduler is a follow-up.

---

### Task 8b: Add missing store methods (run + node-execution)

Before `resolveHumanTask`, the matcher, and the reconciler can compile, the run-store and node-execution-store interfaces must expose the methods they call.

**Files:**
- Modify: `packages/core/src/interfaces/run-store.interface.ts`
- Modify: `packages/core/src/interfaces/node-execution-store.interface.ts`
- Modify: `packages/orchestrator/src/stores/postgres/postgres-run-store.ts`
- Modify: `packages/orchestrator/src/stores/postgres/postgres-node-execution-store.ts`
- Modify: `packages/orchestrator/src/stores/memory/memory-run-store.ts`
- Modify: `packages/orchestrator/src/stores/memory/memory-node-execution-store.ts`

- [ ] **Step 1: Confirm current shape of each interface and store**

Run: `grep -n "interface IRunStore\|interface INodeExecutionStore\|class.*RunStore\|class.*NodeExecutionStore" packages/core/src/interfaces/*.ts packages/orchestrator/src/stores/**/*.ts | head -30`

Use the result to learn the exact file paths in your tree (some monorepo layouts may differ slightly from the table above). Adjust the file list above to match.

- [ ] **Step 2: Add to `IRunStore`**

```ts
findPausedRunsByIssueRef(issueRef: string): Promise<Run[]>;
/** Returns all not-yet-finished runs (status in 'pending','running','paused') for an issueRef. */
findActiveRunsByIssueRef(issueRef: string): Promise<Run[]>;
```

- [ ] **Step 3: Add to `INodeExecutionStore`**

```ts
markWaiting(runId: string, nodeId: string, conductorTaskId: string): Promise<NodeExecution>;
markCompleted(executionId: string, output: Record<string, unknown>): Promise<NodeExecution>;
latestForNode(runId: string, nodeId: string): Promise<NodeExecution | null>;
latestWaitingForRun(runId: string): Promise<NodeExecution | null>;
```

(If your `NodeExecution` type does not yet include `conductorTaskId`, add it: `conductorTaskId?: string | null`.)

- [ ] **Step 4: Postgres `RunStore.findPausedRunsByIssueRef`**

```ts
async findPausedRunsByIssueRef(issueRef: string): Promise<Run[]> {
  const r = await this.pool.query(
    `SELECT * FROM jm_runs
     WHERE status = 'paused' AND (inputs->>'issueRef') = $1
     ORDER BY started_at DESC NULLS LAST`,
    [issueRef],
  );
  return r.rows.map(row => this.rowToRun(row));
}

async findActiveRunsByIssueRef(issueRef: string): Promise<Run[]> {
  const r = await this.pool.query(
    `SELECT * FROM jm_runs
     WHERE status IN ('pending','running','paused') AND (inputs->>'issueRef') = $1
     ORDER BY started_at DESC NULLS LAST`,
    [issueRef],
  );
  return r.rows.map(row => this.rowToRun(row));
}
```

(`rowToRun` is the existing private helper in this file. If it has a different name, use whatever the file already uses.)

- [ ] **Step 5: Postgres `NodeExecutionStore` — new methods + `conductor_task_id` column**

```ts
async markWaiting(runId: string, nodeId: string, conductorTaskId: string): Promise<NodeExecution> {
  // Upsert: if a row exists for (run_id, node_id), set status=waiting + conductor_task_id;
  // otherwise insert a new row.
  const r = await this.pool.query(
    `INSERT INTO jm_node_executions
       (run_id, node_id, attempt, status, started_at, input, conductor_task_id)
     VALUES ($1,$2,1,'waiting', now(), '{}'::jsonb, $3)
     ON CONFLICT (run_id, node_id) DO UPDATE
       SET status='waiting', conductor_task_id = EXCLUDED.conductor_task_id
     RETURNING *`,
    [runId, nodeId, conductorTaskId],
  );
  return this.rowToExec(r.rows[0]);
}

async markCompleted(executionId: string, output: Record<string, unknown>): Promise<NodeExecution> {
  const r = await this.pool.query(
    `UPDATE jm_node_executions
     SET status='completed', completed_at=now(), output=$2
     WHERE id=$1 RETURNING *`,
    [executionId, output],
  );
  return this.rowToExec(r.rows[0]);
}

async latestForNode(runId: string, nodeId: string): Promise<NodeExecution | null> {
  const r = await this.pool.query(
    `SELECT * FROM jm_node_executions
     WHERE run_id=$1 AND node_id=$2
     ORDER BY started_at DESC NULLS LAST LIMIT 1`,
    [runId, nodeId],
  );
  return r.rows[0] ? this.rowToExec(r.rows[0]) : null;
}

async latestWaitingForRun(runId: string): Promise<NodeExecution | null> {
  const r = await this.pool.query(
    `SELECT * FROM jm_node_executions
     WHERE run_id=$1 AND status='waiting'
     ORDER BY started_at DESC NULLS LAST LIMIT 1`,
    [runId],
  );
  return r.rows[0] ? this.rowToExec(r.rows[0]) : null;
}
```

> **Note:** the `ON CONFLICT (run_id, node_id)` clause assumes a unique constraint on `(run_id, node_id)`. If the existing table allows multiple executions per node (retries → multiple rows), drop the upsert and use a plain `INSERT`. Verify with: `grep -rn "run_id.*node_id\|UNIQUE" packages/migrations/src/sql/`. If multiple-rows-per-node is in use, `markWaiting` should always insert a fresh row.

Update `rowToExec` to map `conductor_task_id` → `conductorTaskId`.

- [ ] **Step 6: Memory store implementations**

In `MemoryRunStore`:

```ts
async findPausedRunsByIssueRef(issueRef: string): Promise<Run[]> {
  return this.runs.filter(r =>
    r.status === "paused"
    && (r.inputs as { issueRef?: unknown })?.issueRef === issueRef
  );
}

async findActiveRunsByIssueRef(issueRef: string): Promise<Run[]> {
  const active = new Set(["pending","running","paused"]);
  return this.runs.filter(r =>
    active.has(r.status)
    && (r.inputs as { issueRef?: unknown })?.issueRef === issueRef
  );
}
```

In `MemoryNodeExecutionStore`:

```ts
async markWaiting(runId: string, nodeId: string, conductorTaskId: string): Promise<NodeExecution> {
  const existing = this.rows.find(r => r.runId === runId && r.nodeId === nodeId);
  if (existing) {
    existing.status = "waiting";
    (existing as any).conductorTaskId = conductorTaskId;
    return existing;
  }
  const row: NodeExecution = {
    id: String(this.nextId++),
    runId, nodeId, attempt: 1, status: "waiting",
    startedAt: new Date(), completedAt: null,
    input: {}, output: null, errorClass: null, errorMessage: null,
    ...({ conductorTaskId } as any),
  };
  this.rows.push(row);
  return row;
}

async markCompleted(executionId: string, output: Record<string, unknown>): Promise<NodeExecution> {
  const row = this.rows.find(r => r.id === executionId);
  if (!row) throw new Error(`execution ${executionId} not found`);
  row.status = "completed";
  row.completedAt = new Date();
  row.output = output;
  return row;
}

async latestForNode(runId: string, nodeId: string): Promise<NodeExecution | null> {
  return this.rows
    .filter(r => r.runId === runId && r.nodeId === nodeId)
    .sort((a,b) => +(b.startedAt ?? 0) - +(a.startedAt ?? 0))[0] ?? null;
}

async latestWaitingForRun(runId: string): Promise<NodeExecution | null> {
  return this.rows
    .filter(r => r.runId === runId && r.status === "waiting")
    .sort((a,b) => +(b.startedAt ?? 0) - +(a.startedAt ?? 0))[0] ?? null;
}
```

---

### Task 8c: Engine reconciler service

The reconciler asks Conductor "what's happening on this workflow?" and writes any IN_PROGRESS HUMAN tasks into our DB as `waiting` node executions, plus flips the run to `paused`. It is idempotent — calling it repeatedly is safe.

**Files:**
- Create: `packages/api-server/src/services/engine-reconciler.ts`

- [ ] **Step 1: Implement the reconciler**

```ts
import type { Composition } from "../composition.ts";

export interface ReconcileResult {
  pendingNodeIds: string[];
}

/**
 * Sync our DB with Conductor's view for a single run. Specifically:
 *   - find HUMAN tasks with Conductor status IN_PROGRESS
 *   - upsert NodeExecution rows with status='waiting' and conductor_task_id
 *   - set Run.status='paused' if any HUMAN task is in progress
 *   - emit `node.waiting` event the first time we see one
 *
 * Idempotent. Call before any read or resolve operation that depends on
 * "is this run waiting on a human?".
 */
export async function reconcileRun(c: Composition, runId: string): Promise<ReconcileResult> {
  const run = await c.runs.getById(runId);
  if (!run || !run.engineWorkflowId) return { pendingNodeIds: [] };

  let wf;
  try {
    wf = await c.conductorClient.getWorkflowWithTasks(run.engineWorkflowId);
  } catch (err) {
    // If Conductor is unreachable we just leave the DB as-is.
    return { pendingNodeIds: [] };
  }

  const humanInProgress = (wf.tasks ?? []).filter(t =>
    t.taskType === "HUMAN" && t.status === "IN_PROGRESS"
  );

  const pendingNodeIds: string[] = [];
  for (const t of humanInProgress) {
    const nodeId = t.referenceTaskName;
    const existing = await c.nodeExecutions.latestForNode(runId, nodeId);
    if (existing && existing.status === "waiting") {
      // Already known. Update the conductor_task_id only if missing.
      if (!(existing as any).conductorTaskId) {
        await c.nodeExecutions.markWaiting(runId, nodeId, t.taskId);
      }
    } else {
      await c.nodeExecutions.markWaiting(runId, nodeId, t.taskId);
      const node = run.definitionSnapshot.nodes.find(n => n.id === nodeId);
      const cfg = (node?.config ?? {}) as { prompt?: string; outcomes?: string[]; listensFor?: string[] };
      await c.events.create({
        runId,
        nodeId,
        eventType: "node.waiting",
        payload: { prompt: cfg.prompt, outcomes: cfg.outcomes ?? [], listensFor: cfg.listensFor },
      });
    }
    pendingNodeIds.push(nodeId);
  }

  if (humanInProgress.length > 0 && run.status !== "paused") {
    await c.runs.setStatus(runId, "paused");
  }

  return { pendingNodeIds };
}
```

---

### Task 9: `resolveHumanTask` service — the single mutation entry point

**Files:**
- Create: `packages/api-server/src/services/resolve-human-task.ts`

- [ ] **Step 1: Implement the service**

```ts
import type { Composition } from "../composition.ts";
import type { HumanTaskSource } from "@journeyman/core";

export interface ResolveHumanTaskInput {
  runId: string;
  nodeId: string;
  outcome: string;
  comment: string | null;
  actor: string | null;
  source: HumanTaskSource;
  webhookEventId?: string | null;
}

export class HumanTaskNotWaitingError extends Error {
  constructor(runId: string, nodeId: string) {
    super(`Human-task ${runId}/${nodeId} is not in waiting state`);
    this.name = "HumanTaskNotWaitingError";
  }
}

export class HumanTaskInvalidOutcomeError extends Error {
  constructor(outcome: string, declared: string[]) {
    super(`Outcome '${outcome}' is not one of declared outcomes [${declared.join(", ")}]`);
    this.name = "HumanTaskInvalidOutcomeError";
  }
}

export async function resolveHumanTask(c: Composition, input: ResolveHumanTaskInput): Promise<void> {
  const run = await c.runs.getById(input.runId);
  if (!run) throw new Error(`run ${input.runId} not found`);

  const node = run.definitionSnapshot.nodes.find(n => n.id === input.nodeId);
  if (!node || node.type !== "human-task") {
    throw new Error(`node ${input.nodeId} on run ${input.runId} is not a human-task`);
  }

  const declared = ((node.config as { outcomes?: string[] } | undefined)?.outcomes) ?? [];
  if (!declared.includes(input.outcome)) {
    throw new HumanTaskInvalidOutcomeError(input.outcome, declared);
  }

  const exec = await c.nodeExecutions.latestForNode(input.runId, input.nodeId);
  if (!exec || exec.status !== "waiting") {
    throw new HumanTaskNotWaitingError(input.runId, input.nodeId);
  }

  const conductorTaskId = (exec as { conductorTaskId?: string | null }).conductorTaskId;
  if (!conductorTaskId) {
    // Reconciler hasn't recorded the Conductor task id yet — try once to fill it.
    const { reconcileRun } = await import("./engine-reconciler.ts");
    await reconcileRun(c, input.runId);
    const refreshed = await c.nodeExecutions.latestForNode(input.runId, input.nodeId);
    if (!refreshed || !(refreshed as { conductorTaskId?: string | null }).conductorTaskId) {
      throw new Error(`No conductor_task_id recorded for ${input.runId}/${input.nodeId}`);
    }
    (exec as { conductorTaskId?: string | null }).conductorTaskId =
      (refreshed as { conductorTaskId?: string | null }).conductorTaskId;
  }

  c.humanTaskTimeouts.cancel(input.runId, input.nodeId);

  await c.humanTaskResolutions.create({
    runId:          input.runId,
    nodeId:         input.nodeId,
    outcome:        input.outcome,
    comment:        input.comment,
    actor:          input.actor,
    source:         input.source,
    webhookEventId: input.webhookEventId ?? null,
  });

  const resolvedAt = new Date().toISOString();
  const output = {
    outcome:    input.outcome,
    comment:    input.comment,
    actor:      input.actor,
    source:     input.source,
    resolvedAt,
  };

  await c.nodeExecutions.markCompleted(exec.id, output);

  await c.events.create({
    runId:     input.runId,
    nodeId:    input.nodeId,
    eventType: "node.resolved",
    payload:   output,
  });

  // Hand the outcome back to Conductor — this unblocks the workflow and the
  // downstream SWITCH routes by `outcome`.
  await c.conductorClient.completeTask({
    workflowInstanceId: run.engineWorkflowId!,
    taskId: (exec as { conductorTaskId?: string }).conductorTaskId!,
    status: "COMPLETED",
    outputData: output,
  });

  await c.runs.setStatus(input.runId, "running");
}
```

> The store methods used here (`latestForNode`, `markCompleted`) are added in Task 8b.

---

### Task 10: Webhook → pending-task matcher

**Files:**
- Create: `packages/api-server/src/services/match-human-tasks.ts`

- [ ] **Step 1: Implement match-and-resolve**

```ts
import type { Composition } from "../composition.ts";
import type { HumanTaskConfig } from "@journeyman/core";
import { getByPath, getStringByPath } from "./jsonpath.ts";
import { resolveHumanTask } from "./resolve-human-task.ts";
import { reconcileRun } from "./engine-reconciler.ts";

export interface WebhookEventInfo {
  id: string;
  provider: string;
  eventType: string | null;
  issueRef: string | null;
  rawPayload: unknown;
}

export interface MatchResult { matched: number; }

export async function matchAndResolveHumanTasks(c: Composition, ev: WebhookEventInfo): Promise<MatchResult> {
  if (!ev.issueRef) return { matched: 0 };

  // Find candidate runs (any not-finished status) and reconcile each so DB
  // reflects current Conductor state — Conductor may have entered a HUMAN
  // task while our DB still shows status='running'.
  const candidates = await c.runs.findActiveRunsByIssueRef(ev.issueRef);
  for (const run of candidates) {
    await reconcileRun(c, run.id);
  }

  // Re-read after reconciliation. Now any run with a HUMAN-in-progress is paused.
  const paused = await c.runs.findPausedRunsByIssueRef(ev.issueRef);
  let matched = 0;

  for (const run of paused) {
    const exec = await c.nodeExecutions.latestWaitingForRun(run.id);
    if (!exec) continue;

    const node = run.definitionSnapshot.nodes.find(n => n.id === exec.nodeId);
    if (!node || node.type !== "human-task") continue;

    const cfg = (node.config ?? {}) as HumanTaskConfig;

    if (cfg.listensFor && ev.eventType && !cfg.listensFor.includes(ev.eventType)) continue;

    const map = cfg.outcomeMap?.[ev.provider];
    if (!map) continue;

    const rawValue = getByPath(ev.rawPayload, map.valuePath);
    if (rawValue == null) continue;

    const outcome = map.map[String(rawValue)];
    if (!outcome) continue;

    const comment = map.commentPath ? getStringByPath(ev.rawPayload, map.commentPath) : null;
    const actor = getStringByPath(ev.rawPayload, "user.accountId")
               ?? getStringByPath(ev.rawPayload, "sender.login")
               ?? null;

    await resolveHumanTask(c, {
      runId:          run.id,
      nodeId:         node.id,
      outcome,
      comment,
      actor,
      source:         "webhook",
      webhookEventId: ev.id,
    });
    matched += 1;
  }

  return { matched };
}
```

> The store methods used here (`findActiveRunsByIssueRef`, `findPausedRunsByIssueRef`) are added in Task 8b.

---

### Task 11: Wire stores + services into composition

**Files:**
- Modify: `packages/api-server/src/composition.ts`

- [ ] **Step 1: Import and instantiate**

Add imports near the top (alongside existing `webhookEvents` setup at lines 81-104):

```ts
import {
  PostgresHumanTaskResolutionStore,
  MemoryHumanTaskResolutionStore,
  type IHumanTaskResolutionStore,
} from "@journeyman/orchestrator/src/stores/human-task-resolution-store.ts";
import { InMemoryHumanTaskTimeoutService, type HumanTaskTimeoutService } from "./services/human-task-timeout.ts";
```

Add to the `Composition` interface:

```ts
humanTaskResolutions: IHumanTaskResolutionStore;
humanTaskTimeouts:    HumanTaskTimeoutService;
conductorClient:      ConductorClient; // already constructed; just expose it
```

(The composition already constructs `conductorClient` — see `packages/api-server/src/composition.ts:107`. This change exposes it on the returned composition object so reconciler and resolver can use it.)

In the `composeMemory` / `composePostgres` setup (alongside `webhookEvents`):

```ts
// memory branch
const humanTaskResolutions = new MemoryHumanTaskResolutionStore();
// postgres branch
const humanTaskResolutions = new PostgresHumanTaskResolutionStore(pool);

// shared
const humanTaskTimeouts = new InMemoryHumanTaskTimeoutService();
```

And include `humanTaskResolutions`, `humanTaskTimeouts`, and `conductorClient` in the returned composition object alongside `webhookEvents`.

---

### Task 12: Manual-resolve API route

**Files:**
- Create: `packages/api-server/src/routes/human-tasks.ts`
- Modify: `packages/api-server/src/server.ts`

- [ ] **Step 1: Create the route file**

```ts
import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import {
  resolveHumanTask,
  HumanTaskNotWaitingError,
  HumanTaskInvalidOutcomeError,
} from "../services/resolve-human-task.ts";

export function registerHumanTaskRoutes(app: FastifyInstance, c: Composition): void {
  app.post("/runs/:runId/human-tasks/:nodeId/resolve", async (req, reply) => {
    const { runId, nodeId } = req.params as { runId: string; nodeId: string };
    const body = (req.body ?? {}) as { outcome?: string; comment?: string };

    if (!body.outcome) {
      reply.code(400);
      return { error: "outcome_required" };
    }

    const actor = (req as any).session?.userId ?? null;

    try {
      await resolveHumanTask(c, {
        runId,
        nodeId,
        outcome: body.outcome,
        comment: body.comment ?? null,
        actor,
        source: "manual",
      });
    } catch (err) {
      if (err instanceof HumanTaskInvalidOutcomeError) {
        reply.code(400);
        return { error: "invalid_outcome", message: err.message };
      }
      if (err instanceof HumanTaskNotWaitingError) {
        reply.code(409);
        return { error: "not_waiting" };
      }
      throw err;
    }

    reply.code(200);
    return { status: "resolved" };
  });
}
```

- [ ] **Step 2: Register in server.ts**

In `packages/api-server/src/server.ts`, alongside the existing `registerWebhookRoutes` / route-registration calls, add:

```ts
import { registerHumanTaskRoutes } from "./routes/human-tasks.ts";
// ...
registerHumanTaskRoutes(app, c);
```

---

### Task 13: Webhook route — insert resolve-pending-task branch

**Files:**
- Modify: `packages/api-server/src/routes/webhooks.ts`

- [ ] **Step 1: Add the matcher call before the new-run branch**

In `packages/api-server/src/routes/webhooks.ts`, find the `// Flow resolution stub` block (currently `const matchingFlows: string[] = [];`). Replace the block from that line down to the closing `for (const flowId of matchingFlows)` loop with:

```ts
import { matchAndResolveHumanTasks } from "../services/match-human-tasks.ts";
// (move the import to the top of the file, alongside the others)

// ----- replaced region -----
const resolveResult = await matchAndResolveHumanTasks(c, {
  id: event.id,
  provider,
  eventType,
  issueRef,
  rawPayload,
});

if (resolveResult.matched > 0) {
  await c.webhookEvents.setStatus(event.id, "processed");
  reply.code(200);
  return { status: "resolved", count: resolveResult.matched };
}

// Flow resolution stub — replace with real resolver when available
const matchingFlows: string[] = [];

if (matchingFlows.length === 0) {
  await c.webhookEvents.setStatus(event.id, "ignored");
  reply.code(200);
  return { status: "ignored" };
}

for (const flowId of matchingFlows) {
  await c.runs.create({
    flowId,
    flowVersionId: null,
    flowNameSnapshot: flowId,
    flowScopeSnapshot: "org",
    definitionSnapshot: {} as any,
    triggerSource: "webhook",
    startedByUserId: null,
    startedByOrgId: null,
    inputs: { issueRef, eventType },
    webhookEventId: event.id,
  });
}
// ----- end replaced region -----
```

(Move the new `import { matchAndResolveHumanTasks } …` line to join the existing imports at the top of the file.)

---

### Task 14: Schedule timeout timers when reconciler observes a new HUMAN task

The worker-harness does NOT need to handle HUMAN tasks — Conductor runs them server-side and our harness only polls SIMPLE tasks. The reconciler is the place where we first learn a HUMAN task exists, so timeout scheduling lives there.

**Files:**
- Modify: `packages/api-server/src/services/engine-reconciler.ts`

- [ ] **Step 1: Schedule timer on first observation**

Inside the `for (const t of humanInProgress)` loop in `reconcileRun`, after the existing `else` branch that calls `markWaiting` + emits `node.waiting`, add:

```ts
const node = run.definitionSnapshot.nodes.find(n => n.id === nodeId);
const cfg = (node?.config ?? {}) as { timeout?: { duration: string; onTimeout: string } };
if (cfg.timeout) {
  const ms = parseDurationMsLite(cfg.timeout.duration);
  const onTimeout = cfg.timeout.onTimeout;
  if (ms > 0 && onTimeout) {
    c.humanTaskTimeouts.schedule(runId, nodeId, ms, async () => {
      const { resolveHumanTask } = await import("./resolve-human-task.ts");
      try {
        await resolveHumanTask(c, {
          runId, nodeId,
          outcome: onTimeout,
          comment: null,
          actor: null,
          source: "timeout",
        });
      } catch (err) {
        // Already resolved by webhook/manual or run cancelled — not an error.
      }
    });
  }
}
```

- [ ] **Step 2: Add the local duration-parser helper at the bottom of the file**

```ts
function parseDurationMsLite(input: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)$/.exec(input.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return n * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const)[m[2] as "ms"];
}
```

(Or, if Task 4's `parseDurationMs` was lifted to a shared module, import it instead — DRY preferred.)

> The timer is in-process only — see Task 8 caveat. Restarts forget pending timeouts. Acceptable for v1; persistent scheduling is a follow-up.

---

### Task 15: Surface pending human-task on run-detail API

**Files:**
- Modify: `packages/api-server/src/routes/runs.ts:60-80`

- [ ] **Step 1: Add `pendingHumanTask` and `humanTaskHistory` to the run-detail response**

In the run-detail handler, alongside the `webhookEventSummary` block, add (note: `reconcileRun` is called first so the DB reflects current Conductor state before we read it):

```ts
import { reconcileRun } from "../services/engine-reconciler.ts";

await reconcileRun(c, run.id);

const waitingExec = await c.nodeExecutions.latestWaitingForRun(run.id);
let pendingHumanTask: {
  nodeId: string;
  prompt?: string;
  outcomes: string[];
  startedAt: string;
  timeout?: { durationMs: number; onTimeout: string };
} | null = null;

if (waitingExec) {
  const node = run.definitionSnapshot.nodes.find(n => n.id === waitingExec.nodeId);
  if (node?.type === "human-task") {
    const cfg = (node.config ?? {}) as import("@journeyman/core").HumanTaskConfig;
    pendingHumanTask = {
      nodeId:    node.id,
      prompt:    cfg.prompt,
      outcomes:  cfg.outcomes,
      startedAt: (waitingExec.startedAt ?? new Date()).toISOString(),
      ...(cfg.timeout ? { timeout: { durationMs: parseDurationMsLite(cfg.timeout.duration), onTimeout: cfg.timeout.onTimeout } } : {}),
    };
  }
}

const humanTaskHistory = await c.humanTaskResolutions.listForRun(run.id);

return {
  run: { ...run, effectiveRole: effectiveRunRole ?? null },
  executions,
  events,
  webhookEvent: webhookEventSummary,
  pendingHumanTask,
  humanTaskHistory,
};
```

Add a small `parseDurationMsLite` near the top of the file (or import from a shared location if Task 4's `parseDurationMs` was extracted):

```ts
function parseDurationMsLite(input: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)$/.exec(input.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return n * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const)[m[2] as "ms"];
}
```

---

## Wave 3 — Editor / UI

### Task 16: Palette tile

**Files:**
- Modify: `packages/flow-editor/src/palette/Palette.tsx`

- [ ] **Step 1: Locate the existing palette groups**

Run: `grep -n "Gates\|gateway-xor\|palette.*group\|paletteItems" packages/flow-editor/src/palette/Palette.tsx` to find the structure.

- [ ] **Step 2: Add `human-task` to the "Gates" group**

In the palette items definition, add (next to `gateway-xor` / `if`):

```tsx
{
  type: "human-task",
  label: "Human Task",
  group: "Gates",
  icon: HourglassIcon,        // import from your existing icon set
  defaultConfig: { outcomes: ["approve", "request-changes"] },
}
```

If the palette uses a different shape, follow the existing pattern for other gateway entries.

---

### Task 17: Properties-panel editor for `human-task`

**Files:**
- Create: `packages/flow-editor/src/properties-panel/HumanTaskConfigEditor.tsx`
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx`

- [ ] **Step 1: Build the editor component**

```tsx
import * as React from "react";
import type { HumanTaskConfig } from "@journeyman/core";

interface Props {
  value: HumanTaskConfig;
  readOnly?: boolean;
  onChange: (next: HumanTaskConfig) => void;
}

export function HumanTaskConfigEditor({ value, readOnly, onChange }: Props): React.ReactElement {
  const update = (patch: Partial<HumanTaskConfig>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">Prompt</span>
        <textarea
          className="w-full mt-1 border rounded p-2"
          value={value.prompt ?? ""}
          disabled={readOnly}
          onChange={e => update({ prompt: e.target.value })}
        />
      </label>

      <fieldset>
        <legend className="text-sm font-medium">Outcomes</legend>
        <OutcomeChipsEditor
          outcomes={value.outcomes ?? []}
          readOnly={readOnly}
          onChange={outcomes => update({ outcomes })}
        />
      </fieldset>

      <label className="block">
        <span className="text-sm font-medium">Listens for (event types, comma-separated)</span>
        <input
          type="text"
          className="w-full mt-1 border rounded p-2"
          value={(value.listensFor ?? []).join(", ")}
          disabled={readOnly}
          onChange={e => update({
            listensFor: e.target.value.split(",").map(s => s.trim()).filter(Boolean),
          })}
        />
      </label>

      <fieldset>
        <legend className="text-sm font-medium">Outcome map (JSON)</legend>
        <textarea
          className="w-full font-mono text-xs border rounded p-2 h-40"
          value={JSON.stringify(value.outcomeMap ?? {}, null, 2)}
          disabled={readOnly}
          onChange={e => {
            try {
              const parsed = JSON.parse(e.target.value);
              update({ outcomeMap: parsed });
            } catch {
              // ignore parse errors mid-edit
            }
          }}
        />
        <p className="text-xs text-gray-500 mt-1">
          Per-provider mapping: {`{ jira: { valuePath, map: { rawValue: outcome }, commentPath? } }`}
        </p>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">Timeout (optional)</legend>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. 48h"
            className="flex-1 border rounded p-2"
            value={value.timeout?.duration ?? ""}
            disabled={readOnly}
            onChange={e => {
              const duration = e.target.value;
              if (!duration) return update({ timeout: undefined });
              update({ timeout: { duration, onTimeout: value.timeout?.onTimeout ?? value.outcomes?.[0] ?? "" } });
            }}
          />
          <select
            className="border rounded p-2"
            value={value.timeout?.onTimeout ?? ""}
            disabled={readOnly || !value.timeout}
            onChange={e => update({ timeout: { duration: value.timeout!.duration, onTimeout: e.target.value } })}
          >
            <option value="">— select outcome —</option>
            {(value.outcomes ?? []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </fieldset>
    </div>
  );
}

function OutcomeChipsEditor({
  outcomes, readOnly, onChange,
}: { outcomes: string[]; readOnly?: boolean; onChange: (next: string[]) => void }): React.ReactElement {
  const [draft, setDraft] = React.useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || outcomes.includes(v)) return;
    onChange([...outcomes, v]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {outcomes.map(o => (
        <span key={o} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-100 text-sm">
          {o}
          {!readOnly && (
            <button
              type="button"
              className="text-gray-500"
              onClick={() => onChange(outcomes.filter(x => x !== o))}
            >×</button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          className="border rounded px-2 py-1 text-sm"
          placeholder="add outcome…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire the editor into `ConfigTab.tsx`**

In `packages/flow-editor/src/properties-panel/ConfigTab.tsx`, find the dispatch on node type. Add:

```tsx
if (node.type === "human-task") {
  return (
    <HumanTaskConfigEditor
      value={(node.config ?? { outcomes: [] }) as HumanTaskConfig}
      readOnly={readOnly}
      onChange={cfg => updateNodeConfig(node.id, cfg)}
    />
  );
}
```

(Import `HumanTaskConfigEditor` and `HumanTaskConfig` at the top.)

---

### Task 18: Canvas — `waiting` node visual state

**Files:**
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx`

- [ ] **Step 1: Locate the node tile renderer**

Run: `grep -n "NodeTile\|renderNode\|status.*running\|className" packages/flow-editor/src/canvas/Canvas.tsx | head -20`

- [ ] **Step 2: Add a `waiting` style and hourglass marker**

In the section that maps `nodeExecution.status` → CSS classes (or inline styles), add:

```tsx
const statusClass = (() => {
  switch (exec?.status) {
    case "running":  return "border-blue-500 animate-pulse";
    case "waiting":  return "border-amber-500 animate-pulse";
    case "completed":return "border-green-500";
    case "failed":   return "border-red-500";
    default:         return "border-gray-300";
  }
})();

// In the node tile JSX, when status === "waiting", overlay an hourglass:
{exec?.status === "waiting" && (
  <span className="absolute top-1 right-1 text-amber-600" title="Waiting for human">
    ⏳
  </span>
)}
```

Adjust class names to match the file's existing styling system.

---

### Task 19: Run-detail human-task panel

**Files:**
- Create: `packages/flow-editor/src/run-detail/HumanTaskPanel.tsx`
- Modify: `packages/flow-editor/src/run-detail/RunDetail.tsx`

- [ ] **Step 1: Build the panel**

```tsx
import * as React from "react";

interface PendingHumanTask {
  nodeId: string;
  prompt?: string;
  outcomes: string[];
  startedAt: string;
  timeout?: { durationMs: number; onTimeout: string };
}

interface ResolutionRow {
  nodeId: string;
  outcome: string;
  comment: string | null;
  actor: string | null;
  source: "webhook" | "manual" | "timeout";
  resolvedAt: string;
}

interface Props {
  runId: string;
  pending: PendingHumanTask | null;
  history: ResolutionRow[];
  onResolved?: () => void;
}

export function HumanTaskPanel({ runId, pending, history, onResolved }: Props): React.ReactElement {
  const [outcome, setOutcome] = React.useState<string>("");
  const [comment, setComment] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => { setOutcome(pending?.outcomes[0] ?? ""); }, [pending?.nodeId]);

  const submit = async () => {
    if (!pending || !outcome) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/runs/${runId}/human-tasks/${pending.nodeId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, comment: comment || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onResolved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <aside className="border-l p-4 w-80">
      <h3 className="font-medium mb-2">Human Task</h3>

      {pending ? (
        <div className="space-y-3">
          <div className="text-sm">
            <div className="text-gray-500">Node</div>
            <div className="font-mono">{pending.nodeId}</div>
          </div>
          {pending.prompt && (
            <div className="text-sm whitespace-pre-wrap">{pending.prompt}</div>
          )}
          <div className="text-xs text-gray-500">
            Waiting since {new Date(pending.startedAt).toLocaleString()}
            {pending.timeout && ` · auto-${pending.timeout.onTimeout} after ${Math.round(pending.timeout.durationMs / 60000)}m`}
          </div>

          <label className="block">
            <span className="text-sm">Outcome</span>
            <select
              className="w-full mt-1 border rounded p-2"
              value={outcome}
              onChange={e => setOutcome(e.target.value)}
            >
              {pending.outcomes.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-sm">Comment (optional)</span>
            <textarea
              className="w-full mt-1 border rounded p-2"
              value={comment}
              onChange={e => setComment(e.target.value)}
            />
          </label>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <button
            type="button"
            disabled={submitting || !outcome}
            onClick={submit}
            className="w-full bg-blue-600 text-white rounded py-2 disabled:opacity-50"
          >
            {submitting ? "Resolving…" : "Resolve"}
          </button>
        </div>
      ) : (
        <div className="text-sm text-gray-500">No human task currently waiting.</div>
      )}

      {history.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-medium mb-2">History</h4>
          <ul className="space-y-2 text-xs">
            {history.map((r, i) => (
              <li key={i} className="border rounded p-2">
                <div><span className="font-mono">{r.nodeId}</span> → <strong>{r.outcome}</strong> ({r.source})</div>
                {r.comment && <div className="text-gray-700 mt-1 whitespace-pre-wrap">{r.comment}</div>}
                <div className="text-gray-500 mt-1">{r.actor ?? "anonymous"} · {new Date(r.resolvedAt).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Mount the panel in `RunDetail.tsx`**

In `packages/flow-editor/src/run-detail/RunDetail.tsx`, alongside the existing run-detail layout:

```tsx
import { HumanTaskPanel } from "./HumanTaskPanel.tsx";
// ...
<HumanTaskPanel
  runId={run.id}
  pending={run.pendingHumanTask ?? null}
  history={run.humanTaskHistory ?? []}
  onResolved={() => refetchRun()}
/>
```

The exact prop names (`refetchRun`, `run.pendingHumanTask`, etc.) must match the run-detail data hook in this file — adapt to the existing names if different.

---

### Task 20: Run-list "Waiting on humans" filter

**Files:**
- Modify: `packages/flow-editor/src/run-list/RunListFilters.tsx`

- [ ] **Step 1: Add the filter chip**

```tsx
<button
  type="button"
  className={`px-2 py-1 text-sm rounded border ${filter === "waiting-human" ? "bg-amber-100 border-amber-500" : ""}`}
  onClick={() => setFilter("waiting-human")}
>
  ⏳ Waiting on humans
</button>
```

The filter sends `?status=paused&waitingOnHuman=1` to the runs list endpoint. On the API side, modify `packages/api-server/src/routes/runs.ts` GET handler: when `waitingOnHuman === "1"`, filter to runs where `status='paused'` AND there exists a `jm_node_executions` row with `status='waiting'` for the run, AND the corresponding node in `definitionSnapshot.nodes` has `type='human-task'`. SQL sketch:

```sql
SELECT r.* FROM jm_runs r
WHERE r.status = 'paused'
  AND EXISTS (
    SELECT 1 FROM jm_node_executions ne
    WHERE ne.run_id = r.id AND ne.status = 'waiting'
  )
ORDER BY r.started_at DESC;
```

(The "node type is human-task" check is enforced in app code by reading `definitionSnapshot` post-fetch — keeps the SQL simple.)

---

## Wave 4 — Verification

### Task 21: Typecheck

**Files:** none

- [ ] **Step 1: Run typecheck across the monorepo**

Run: `npm run typecheck`

Expected: zero errors.

If errors appear, fix them in place. Common culprits:
- Missing re-exports from `@journeyman/core`
- New store methods declared on the interface but not implemented in one of the two store classes (Postgres / memory)
- `HumanTaskConfig` import path mismatch (use `@journeyman/core`, not the file path directly, except inside `core` itself)
- Conductor task union missing the new `HumanTask` shape in a switch/exhaustiveness check

- [ ] **Step 2: Confirm clean output**

Run: `npm run typecheck` again after fixes.

Expected: zero errors. Implementation complete.

---

## Self-Review Checklist (for the implementer)

Before declaring done:

- [ ] Spec §3 (node model) — `HumanTaskConfig` defined; editor validates outcomes ↔ outgoing edges; `timeout.onTimeout` validated against outcomes. ✓ Tasks 1, 4, 17.
- [ ] Spec §4 (engine behavior) — `waiting` status, `node.waiting` event, run → paused via reconciler, single `resolveHumanTask` entry point, three callers (webhook / manual / timeout). ✓ Tasks 8c, 9, 12, 14.
- [ ] Spec §5 (webhook routing) — matcher reconciles then routes before new-run path; correlation by `issueRef`; `listensFor` filter; `outcomeMap` extraction. ✓ Tasks 10, 13.
- [ ] Spec §6 (UI) — palette tile, properties panel, canvas waiting state, run-detail panel, run-list filter. ✓ Tasks 16-20.
- [ ] Spec §7 (data model) — types, migration (with `conductor_task_id`), converter case, API routes, store methods. ✓ Tasks 1, 2, 3, 4, 8b, 11, 12, 13, 15.
- [ ] Spec §8 (out of scope) — no HMAC, no assignees, no notifications, no parallel human-tasks, no non-issueRef correlation implemented. ✓ verified by absence.
