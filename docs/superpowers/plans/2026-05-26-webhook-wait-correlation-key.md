# Webhook-Wait Correlation Key — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken instance-level `issueRef`/`issueRefFromPath` correlation with a per-wait `correlationKey { eventPath, value }` on `webhook-wait`. Snapshot the resolved value at pause time and match it against incoming events.

**Architecture:** Drop trigger-side `issueRefFromPath` entirely (no replacement — triggers don't need correlation). Add `correlation_event_path` and `correlation_value` columns to `jm_node_executions`. The `webhook-wait` node config gains a `correlationKey` block. When the engine pauses a wait, it resolves the value template against current instance state and writes both columns. The matcher reads the incoming event's `eventPath`, looks up waits with the same `correlation_value`, and resumes them after `acceptIf` passes.

**Tech Stack:** TypeScript, Postgres, Fastify, React. Spec: [docs/superpowers/specs/2026-05-26-webhook-wait-correlation-key-design.md](docs/superpowers/specs/2026-05-26-webhook-wait-correlation-key-design.md).

**User constraints:**
- No git commits — do not stage or commit at any point.
- No unit tests — skip TDD steps in this plan.
- Run `npm run check` (typecheck + import-boundaries) as the final verification.

---

## File map

| File | Action | Why |
|---|---|---|
| `packages/migrations/src/sql/030_webhook_wait_correlation.sql` | Create | Add `correlation_event_path`, `correlation_value` columns + index |
| `packages/core/src/types/webhook-wait.types.ts` | Modify | Replace literal `correlationKey?: "issueRef"` with `correlationKey?: CorrelationKey` |
| `packages/core/src/types/workflow-trigger.types.ts` | Modify | Remove `issueRefFromPath` from `TriggerWebhookConfig` |
| `packages/core/src/types/workflow-instance.types.ts` | Modify | Add `correlationEventPath` / `correlationValue` to `NodeExecution` |
| `packages/core/src/interfaces/orchestrator-engine.interface.ts` | Modify | Drop `issueRef` from `SubmitWorkflowInstanceArgs` |
| `packages/core/src/interfaces/workflow-instance-store.interface.ts` | Modify | Drop `findActiveInstancesByIssueRef`, `findPausedInstancesByIssueRef`, `CreateWorkflowInstanceArgs.issueRef`, list/count `issueRef` opts |
| `packages/core/src/utils/validate-workflow.ts` | Modify | Reject publish if a `webhook-wait` is missing `correlationKey` |
| `packages/orchestrator/src/stores/postgres/postgres-workflow-instance-store.ts` | Modify | Drop `find*ByIssueRef`, `issueRef` in list/create; extend `markWaiting` to accept correlation; map correlation columns in `rowToExec` |
| `packages/orchestrator/src/stores/memory/memory-workflow-instance-store.ts` | Modify | Same as Postgres store |
| `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts` | Modify | Drop `issueRef` from `create()` call |
| `packages/orchestrator/src/flow-json/conductor-converter.ts` | Modify | Drop `correlationKey: "issueRef"` plumbing |
| `packages/orchestrator/src/flow-json/conductor-types.ts` | Modify | Drop `correlationKey?: "issueRef"` field |
| `packages/orchestrator/src/workers/handlers/webhook-wait-handler.ts` (or equivalent) | Modify | At pause time: resolve `correlationKey.value` template, call `markWaiting` with correlation values |
| `packages/api-server/src/services/webhook-trigger-fire.ts` | Modify | Remove `issueRefFromPath` extraction and `issueRef` from `submit()` |
| `packages/api-server/src/services/webhook-ingest.ts` | Modify | Drop the legacy `issueRef` extraction block (lines ~126-145); update `matchAndResolveWebhookWaits` call signature |
| `packages/api-server/src/services/match-human-tasks.ts` | Rewrite | Replace `findPausedInstancesByIssueRef` with new correlation-value lookup; evaluate `eventPath` against event payload |
| `packages/flow-editor/src/properties-panel/trigger-webhook-panel.tsx` | Modify | Remove `IssueRef from path (optional)` UI field |
| `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx` | Modify | Add Correlation section UI |
| `packages/orchestrator/src/migrations/load-time-strip.ts` (or wherever legacy stripping lives) | Modify if exists, otherwise add to graph-load path | Strip `issueRefFromPath` from incoming workflow graphs |

---

## Task 1: Locate the webhook-wait pause handler and instance-graph load hook

Some of the later tasks need exact file paths that depend on engine wiring. Find them first.

**Files:**
- Read-only investigation

- [ ] **Step 1: Find the worker handler that emits `markWaiting` for `webhook-wait`**

```bash
grep -rn "webhook-wait" packages/orchestrator/src --include="*.ts" | grep -i "handler\|worker\|wait\|pause"
grep -rn "markWaiting" packages/orchestrator/src --include="*.ts"
```

Record the file + function where the workflow execution causes a `webhook-wait` to enter `waiting` status. This is where `correlationKey.value` must be resolved against instance state at pause time.

- [ ] **Step 2: Find the workflow-graph load hook (where legacy fields get stripped)**

```bash
grep -rn "config.mcp\|legacy\|stripLegacy\|migrate" packages/core/src packages/orchestrator/src --include="*.ts" | grep -iv "test"
```

Per CLAUDE.md: "Legacy `config.mcp` / `config.allowedTools` migration (load-time strip) — Implemented." Find that strip location; that's where `issueRefFromPath` strip will go.

- [ ] **Step 3: Confirm whether `latestWaitingForInstance` (or similar) returns the `correlation_*` columns**

The `rowToExec` function in `packages/orchestrator/src/stores/postgres/postgres-workflow-instance-store.ts:237` must map the new columns. Verify the matcher path that reads paused waits goes through `rowToExec`.

---

## Task 2: Migration — add correlation columns to `jm_node_executions`

**Files:**
- Create: `packages/migrations/src/sql/030_webhook_wait_correlation.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 030_webhook_wait_correlation.sql
-- Add per-wait correlation fields. Resolved at pause time from
-- webhook-wait.config.correlationKey.value, matched at event-arrival time.

ALTER TABLE jm_node_executions
  ADD COLUMN IF NOT EXISTS correlation_event_path TEXT,
  ADD COLUMN IF NOT EXISTS correlation_value      TEXT;

CREATE INDEX IF NOT EXISTS jm_node_executions_correlation_value_idx
  ON jm_node_executions (correlation_value)
  WHERE status = 'waiting';
```

No backfill: pre-existing paused waits cannot be resumed under the new model regardless. The publish-validation gate (Task 7) prevents future workflows from saving without the new field.

---

## Task 3: Core types — new `CorrelationKey` shape

**Files:**
- Modify: `packages/core/src/types/webhook-wait.types.ts`
- Modify: `packages/core/src/types/workflow-trigger.types.ts`
- Modify: `packages/core/src/types/workflow-instance.types.ts`

- [ ] **Step 1: Add `CorrelationKey` type and update `WebhookWaitConfig`**

In `packages/core/src/types/webhook-wait.types.ts`, replace the `correlationKey?: "issueRef"` field:

```ts
import type { WorkflowInputValue } from "./flow.types.ts";
import type { JsonLogicExpr } from "./flow-condition.types.ts";

/**
 * How a paused webhook-wait correlates to an incoming event.
 *
 * - `eventPath`: JSONPath into the inbound event payload (e.g. "$.pull_request.number").
 * - `value`: a WorkflowInputValue (literal | ref | template) resolved against
 *   the workflow instance's state at pause time. The resolved string is
 *   snapshotted onto `jm_node_executions.correlation_value`.
 */
export interface CorrelationKey {
  eventPath: string;
  value: WorkflowInputValue;
}

export interface WebhookWaitOutputField {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "date";
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  fromPath?: string;
}

export interface WebhookWaitConfig {
  webhookId: string;
  listensFor?: string[];
  acceptIf?: JsonLogicExpr;
  /** Required at publish time. Determines which paused wait an incoming event resumes. */
  correlationKey?: CorrelationKey;
  outputs: WebhookWaitOutputField[];
  timeout?: {
    duration: string;
    defaults?: Record<string, unknown>;
  };
}

export const WEBHOOK_WAIT_RESERVED_KEYS = ["source", "resolvedAt", "webhookEventId", "payload"] as const;
export type WebhookWaitReservedKey = typeof WEBHOOK_WAIT_RESERVED_KEYS[number];

export type WebhookWaitSource = "webhook" | "timeout";

export type WebhookWaitOutput = {
  source: WebhookWaitSource;
  resolvedAt: string;
  webhookEventId: string | null;
  payload: Record<string, unknown>;
} & Record<string, unknown>;
```

- [ ] **Step 2: Remove `issueRefFromPath` from `TriggerWebhookConfig`**

In `packages/core/src/types/workflow-trigger.types.ts`, delete these lines:

```ts
  /** Optional path to extract a downstream-correlatable issueRef from the payload. */
  issueRefFromPath?: string;
```

The interface becomes:

```ts
export interface TriggerWebhookConfig {
  webhookId: string;
  listensFor?: string[];
  acceptIf?: JsonLogicExpr;
  inputsMapping: Record<string, TriggerInputMapping>;
}
```

- [ ] **Step 3: Add correlation fields to `NodeExecution`**

In `packages/core/src/types/workflow-instance.types.ts`, append to `NodeExecution`:

```ts
export interface NodeExecution {
  id: string;
  workflowInstanceId: string;
  nodeId: string;
  attempt: number;
  status: NodeExecutionStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorClass: string | null;
  errorMessage: string | null;
  conductorTaskId?: string | null;
  /** Set when the engine pauses a webhook-wait. Both null on non-wait executions. */
  correlationEventPath?: string | null;
  correlationValue?: string | null;
}
```

---

## Task 4: Core interfaces — drop instance-level `issueRef`

**Files:**
- Modify: `packages/core/src/interfaces/orchestrator-engine.interface.ts`
- Modify: `packages/core/src/interfaces/workflow-instance-store.interface.ts`

- [ ] **Step 1: Drop `issueRef` from `SubmitWorkflowInstanceArgs`**

In `packages/core/src/interfaces/orchestrator-engine.interface.ts`, delete the block:

```ts
  /** Optional issueRef for cross-instance correlation (e.g. extracted via trigger-webhook.issueRefFromPath). */
  issueRef?: string | null;
```

- [ ] **Step 2: Drop `issueRef` from `CreateWorkflowInstanceArgs` and the list/count filters**

In `packages/core/src/interfaces/workflow-instance-store.interface.ts`:

- Remove `issueRef?: string | null` from `CreateWorkflowInstanceArgs`.
- Remove `issueRef?: string` from `list()` and `count()` options.
- Remove the two method signatures `findPausedInstancesByIssueRef` and `findActiveInstancesByIssueRef`.

`INodeExecutionStore` gains a new method:

```ts
export interface INodeExecutionStore {
  upsert(execution: NodeExecution): Promise<void>;
  listByWorkflowInstance(workflowInstanceId: string): Promise<NodeExecution[]>;
  markWaiting(
    workflowInstanceId: string,
    nodeId: string,
    conductorTaskId: string,
    correlation?: { eventPath: string; value: string } | null,
  ): Promise<NodeExecution>;
  markCompleted(executionId: string, output: Record<string, unknown>): Promise<NodeExecution>;
  latestForNode(workflowInstanceId: string, nodeId: string): Promise<NodeExecution | null>;
  latestWaitingForInstance(workflowInstanceId: string): Promise<NodeExecution | null>;
  /** Lookup waits eligible for resumption by an event matching value at the wait's declared eventPath. */
  findWaitingByCorrelationValue(correlationValue: string): Promise<NodeExecution[]>;
  listOverAgePausedNodeExecutions(maxAgeMs: number, limit: number): Promise<NodeExecution[]>;
}
```

---

## Task 5: Postgres store — apply interface changes + new lookup

**Files:**
- Modify: `packages/orchestrator/src/stores/postgres/postgres-workflow-instance-store.ts`

- [ ] **Step 1: Remove `find*ByIssueRef` methods**

Delete `findPausedInstancesByIssueRef` (lines 216-224) and `findActiveInstancesByIssueRef` (lines 226-234).

- [ ] **Step 2: Remove `issueRef` from `buildListQuery`**

Delete this line in `buildListQuery`:

```ts
    if (opts.issueRef)   { conds.push(`w.issue_ref = $${nextIdx()}`);      params.push(opts.issueRef); }
```

Update the `webhookJoin` condition to drop `opts.issueRef`:

```ts
    const webhookJoin = opts.provider
      ? "LEFT JOIN jm_webhook_events w ON r.webhook_event_id = w.id"
      : "";
```

Remove the `issueRef?: string;` field from the `buildListQuery` opts type and from `list()`/`count()` opts.

- [ ] **Step 3: Update `rowToExec` to map correlation columns**

Replace `rowToExec` (line 237) with:

```ts
function rowToExec(row: any): NodeExecution {
  return {
    id: row.id,
    workflowInstanceId: row.workflow_instance_id,
    nodeId: row.node_id,
    attempt: row.attempt,
    status: row.status,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    input: row.input ?? {},
    output: row.output,
    errorClass: row.error_class,
    errorMessage: row.error_message,
    conductorTaskId: row.conductor_task_id ?? null,
    correlationEventPath: row.correlation_event_path ?? null,
    correlationValue: row.correlation_value ?? null,
  };
}
```

- [ ] **Step 4: Update `markWaiting` to accept and write correlation values**

Replace the existing `markWaiting`:

```ts
  async markWaiting(
    workflowInstanceId: string,
    nodeId: string,
    conductorTaskId: string,
    correlation?: { eventPath: string; value: string } | null,
  ): Promise<NodeExecution> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_node_executions
         (workflow_instance_id, node_id, attempt, status, started_at, input,
          conductor_task_id, correlation_event_path, correlation_value)
       VALUES ($1, $2, 1, 'waiting', now(), '{}'::jsonb, $3, $4, $5)
       ON CONFLICT (workflow_instance_id, node_id, attempt) DO UPDATE SET
         status = 'waiting',
         conductor_task_id = EXCLUDED.conductor_task_id,
         correlation_event_path = EXCLUDED.correlation_event_path,
         correlation_value = EXCLUDED.correlation_value
       RETURNING *`,
      [
        workflowInstanceId, nodeId, conductorTaskId,
        correlation?.eventPath ?? null,
        correlation?.value ?? null,
      ],
    );
    return rowToExec(rows[0]);
  }
```

- [ ] **Step 5: Add `findWaitingByCorrelationValue`**

Append to `PostgresNodeExecutionStore`:

```ts
  async findWaitingByCorrelationValue(correlationValue: string): Promise<NodeExecution[]> {
    const { rows } = await this.pool.query(
      `SELECT ne.*
         FROM jm_node_executions ne
         JOIN jm_workflow_instances wi ON wi.id = ne.workflow_instance_id
        WHERE ne.status = 'waiting'
          AND wi.status = 'paused'
          AND ne.correlation_value = $1`,
      [correlationValue],
    );
    return rows.map(rowToExec);
  }
```

- [ ] **Step 6: Remove `issueRef` from `create()`**

The `create()` method already doesn't write any `issue_ref` column (confirmed in the spec). Just remove the `issueRef` field from its `CreateWorkflowInstanceArgs` typing if surfaced anywhere in the file.

---

## Task 6: Memory store — same changes as Postgres

**Files:**
- Modify: `packages/orchestrator/src/stores/memory/memory-workflow-instance-store.ts`

- [ ] **Step 1: Remove `find*ByIssueRef` methods**

Delete `findPausedInstancesByIssueRef` (lines 111-116) and `findActiveInstancesByIssueRef` (lines 118-124).

- [ ] **Step 2: Remove `issueRef` filter opts**

Delete `issueRef?: string;` from the `list()` and `count()` opts type signatures.

- [ ] **Step 3: Extend `markWaiting` signature + record correlation on the in-memory row**

Mirror the Postgres signature. Store `correlationEventPath` and `correlationValue` on the in-memory `NodeExecution` row.

- [ ] **Step 4: Add `findWaitingByCorrelationValue`**

```ts
  async findWaitingByCorrelationValue(correlationValue: string): Promise<NodeExecution[]> {
    const instancesPaused = new Set(
      [...this.rows.values()]
        .filter((r) => r.status === "paused")
        .map((r) => r.id),
    );
    return [...this.execs.values()].filter((e) =>
      e.status === "waiting"
      && instancesPaused.has(e.workflowInstanceId)
      && e.correlationValue === correlationValue,
    );
  }
```

(Adapt to the actual field name for the execs collection in this file — look near `latestWaitingForInstance`.)

---

## Task 7: Validation — require `correlationKey` on `webhook-wait` at publish

**Files:**
- Modify: `packages/core/src/utils/validate-workflow.ts`

- [ ] **Step 1: Add a publish-time check**

Inside `validateWorkflow` (or the equivalent publish-mode validator), add:

```ts
import type { WebhookWaitConfig, WorkflowGraph, WorkflowSaveWarning } from "../types/flow.types.ts";
// (CorrelationKey is part of WebhookWaitConfig now)

for (const n of graph.nodes) {
  if (n.type !== "webhook-wait") continue;
  const cfg = (n.config ?? {}) as Partial<WebhookWaitConfig>;
  const ck = cfg.correlationKey;
  const hasEventPath = !!ck?.eventPath && ck.eventPath.trim() !== "";
  const hasValue = !!ck?.value;
  if (!hasEventPath || !hasValue) {
    errors.push({
      nodeId: n.id,
      code: "webhook_wait_correlation_required",
      message: `Webhook-wait "${n.displayName ?? n.id}" needs a correlation key (event path and value).`,
    });
  }
}
```

Match the existing error/warning shape used in this file. Run only in publish (strict) mode if the validator distinguishes — the file already has examples (`mcp-required`, `skills-required`).

---

## Task 8: Conductor adapter — drop `issueRef` and `correlationKey: "issueRef"`

**Files:**
- Modify: `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`
- Modify: `packages/orchestrator/src/flow-json/conductor-types.ts`

- [ ] **Step 1: Drop `issueRef` from the `create()` call**

In `conductor-orchestrator.ts` line ~61, remove:

```ts
      issueRef: args.issueRef ?? null,
```

- [ ] **Step 2: Drop `correlationKey: "issueRef"` from the emitted task definition**

In `conductor-converter.ts` line ~439, delete:

```ts
        correlationKey: cfg.correlationKey ?? "issueRef",
```

If the surrounding object becomes empty, simplify it.

- [ ] **Step 3: Drop the field from the Conductor task type**

In `conductor-types.ts` line ~93, delete:

```ts
    correlationKey?: "issueRef";
```

---

## Task 9: Webhook-wait pause handler — resolve template, write correlation

**Files:**
- Modify: the handler identified in Task 1 (the one that emits `markWaiting` for `webhook-wait`).

- [ ] **Step 1: Read instance state needed to resolve `WorkflowInputValue`**

Per [packages/core/src/types/flow.types.ts:55](packages/core/src/types/flow.types.ts:55), `WorkflowInputValue` is `{ kind: "literal" | "ref" | "template" }`. The codebase already has a resolver — find it:

```bash
grep -rn "WorkflowInputValue\|kind === \"literal\"\|kind === \"ref\"\|kind === \"template\"" packages/orchestrator/src --include="*.ts"
```

Use the existing resolver. If a shared helper does not exist for this pause path, inline the three-case switch (literal returns `value`, ref looks up by dotted path against `{ inputs, outputs }`, template substitutes `{{ ... }}` against the same context).

- [ ] **Step 2: At pause time, resolve `correlationKey.value` and call `markWaiting`**

Pseudocode for the handler:

```ts
import type { WebhookWaitConfig } from "@journeyman/core";

const cfg = (node.config ?? {}) as WebhookWaitConfig;
let correlation: { eventPath: string; value: string } | null = null;

if (cfg.correlationKey?.eventPath && cfg.correlationKey?.value) {
  const resolved = resolveWorkflowInputValue(
    cfg.correlationKey.value,
    { inputs: instance.inputs, outputs: collectedNodeOutputs },
  );
  if (resolved != null) {
    correlation = {
      eventPath: cfg.correlationKey.eventPath,
      value: String(resolved),
    };
  }
}

await nodeExecutions.markWaiting(instance.id, node.id, conductorTaskId, correlation);
```

If `cfg.correlationKey` is missing or the resolution yields `null`/`undefined`, pass `null` — the wait will never be matched, but that's the user's bug (publish validation should have caught it). Do not throw.

---

## Task 10: Matcher rewrite — use correlation_value, drop issueRef path

**Files:**
- Modify: `packages/api-server/src/services/match-human-tasks.ts`
- Modify: `packages/api-server/src/services/webhook-ingest.ts`
- Modify: `packages/api-server/src/services/webhook-trigger-fire.ts`

- [ ] **Step 1: Rewrite `matchAndResolveWebhookWaits` in `match-human-tasks.ts`**

Replace the entire body. The new signature accepts the event payload and event type; lookups go through `nodeExecutions.findWaitingByCorrelationValue`. The `WebhookEventInfo.issueRef` field is no longer used and may be removed from the type (but leaving it as a deprecated field is also acceptable since `WebhookEvent.issueRef` still exists in the DB).

```ts
import type { Composition } from "../composition.ts";
import type { WebhookWaitConfig, WebhookWaitOutputField } from "@journeyman/core";
import { getByPath } from "./jsonpath.ts";
import { resolveHumanTask } from "./resolve-human-task.ts";
import { reconcileWorkflowInstance } from "./engine-reconciler.ts";

export interface WebhookEventInfo {
  id: string;
  provider: string;
  eventType: string | null;
  rawPayload: unknown;
}

export interface MatchResult { matched: number; }

export async function matchAndResolveWebhookWaits(
  c: Composition,
  ev: WebhookEventInfo,
): Promise<MatchResult> {
  // We don't know a-priori which eventPath the matching waits declared.
  // Strategy: find all paused waits (via the matcher candidates set) whose
  // recorded correlation_event_path extracts the same value from this event.
  //
  // Implementation detail: we don't have an index per (event_type, path).
  // For v1, pull all paused waits keyed by candidate values we can extract.
  // Simpler and correct: scan waiting node-executions joined to paused
  // instances, then filter in code by (eventType-listensFor) and value-equality.

  // For now: read ALL paused-instance waits with non-null correlation_value,
  // then filter by `extract(event.payload, ne.correlation_event_path) === ne.correlation_value`
  // and by `listensFor` from the node's snapshot.
  //
  // If this becomes a bottleneck, bucket by (event_type, correlation_event_path)
  // — see spec § Open questions.

  const candidates = await c.nodeExecutions.findAllWaitingWithCorrelation();
  // ^ NEW lightweight method — see Task 10 Step 2.

  let matched = 0;

  for (const exec of candidates) {
    if (!exec.correlationEventPath || !exec.correlationValue) continue;

    const eventValue = getByPath(ev.rawPayload, exec.correlationEventPath);
    if (eventValue == null || String(eventValue) !== exec.correlationValue) continue;

    const instance = await c.workflowInstances.getById(exec.workflowInstanceId);
    if (!instance) continue;

    // Reconcile in case Conductor already entered HUMAN but our DB still shows running.
    if (instance.status !== "paused") {
      await reconcileWorkflowInstance(c, instance.id);
    }
    const refreshed = await c.workflowInstances.getById(exec.workflowInstanceId);
    if (!refreshed || refreshed.status !== "paused") continue;

    const node = refreshed.definitionSnapshot.nodes.find((n) => n.id === exec.nodeId);
    if (!node || node.type !== "webhook-wait") continue;

    const cfg = (node.config ?? {}) as unknown as WebhookWaitConfig;

    // Filter 1: event-type allowlist.
    if (cfg.listensFor && cfg.listensFor.length > 0 && ev.eventType) {
      if (!cfg.listensFor.includes(ev.eventType)) continue;
    }

    // Filter 2: acceptIf JSONLogic.
    if (cfg.acceptIf) {
      const data = (ev.rawPayload ?? {}) as Record<string, unknown>;
      const ok = c.conditions.evaluate(cfg.acceptIf as unknown, data);
      if (!ok) continue;
    }

    // Extract declared outputs.
    const outputs: WebhookWaitOutputField[] = Array.isArray(cfg.outputs) ? cfg.outputs : [];
    const values: Record<string, unknown> = {};
    for (const o of outputs) {
      if (!o.fromPath) continue;
      const v = getByPath(ev.rawPayload, o.fromPath);
      if (v != null) values[o.name] = coerce(v, o.type);
    }

    const actor = pickActor(ev.rawPayload);

    await resolveHumanTask(c, {
      workflowInstanceId: refreshed.id,
      nodeId: node.id,
      values,
      payload: (ev.rawPayload ?? {}) as Record<string, unknown>,
      actor,
      source: "webhook",
      webhookEventId: ev.id,
    });
    matched += 1;
  }

  return { matched };
}

function pickActor(payload: unknown): string | null {
  const candidates = [
    "user.accountId", "sender.login", "user.username", "userId",
  ];
  for (const path of candidates) {
    const v = getByPath(payload, path);
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function coerce(value: unknown, type: WebhookWaitOutputField["type"]): unknown {
  switch (type) {
    case "string":  return typeof value === "string" ? value : String(value);
    case "number":  return typeof value === "number" ? value : Number(value);
    case "boolean": return typeof value === "boolean" ? value : value === "true" || value === 1;
    case "date":    return typeof value === "string" ? value : String(value);
    case "json":    return value;
  }
}
```

- [ ] **Step 2: Add `findAllWaitingWithCorrelation` to the node-execution store**

Add to `INodeExecutionStore`:

```ts
findAllWaitingWithCorrelation(): Promise<NodeExecution[]>;
```

Postgres impl:

```ts
async findAllWaitingWithCorrelation(): Promise<NodeExecution[]> {
  const { rows } = await this.pool.query(
    `SELECT ne.*
       FROM jm_node_executions ne
       JOIN jm_workflow_instances wi ON wi.id = ne.workflow_instance_id
      WHERE ne.status = 'waiting'
        AND wi.status = 'paused'
        AND ne.correlation_value IS NOT NULL`,
  );
  return rows.map(rowToExec);
}
```

Memory impl: analogous filter over the in-memory rows.

(Drop the `findWaitingByCorrelationValue` method from Task 4/5/6 — `findAllWaitingWithCorrelation` supersedes it, since the matcher needs the full set to evaluate per-wait `eventPath`.)

- [ ] **Step 3: Update `webhook-ingest.ts` — remove legacy `issueRef` block, update matcher call**

In `packages/api-server/src/services/webhook-ingest.ts`:

- Delete lines 126-145 (the legacy correlation-suggestions `issueRef` extraction and the `UPDATE jm_webhook_events SET issue_ref = …` query). The `WebhookEvent.issueRef` column stays in the DB but is no longer populated by ingest.
- Change the matcher call to drop the `issueRef` arg:

```ts
const result = await matchAndResolveWebhookWaits(c, {
  id: event.id,
  provider: webhook.preset,
  eventType,
  rawPayload: input.rawPayload,
});
```

- In the `c.webhookEvents.create({ … })` call, drop `issueRef: null` (or leave it — the column still exists in `jm_webhook_events`, but it will simply always be null going forward; either is fine).

- [ ] **Step 4: Strip `issueRef` from `webhook-trigger-fire.ts`**

In `packages/api-server/src/services/webhook-trigger-fire.ts`, remove the block (lines 70-72) that extracts `issueRef` from `cfg.issueRefFromPath`, and remove `issueRef` from the `c.orchestrator.submit({ … })` call (line 86).

---

## Task 11: Load-time strip of legacy `issueRefFromPath`

**Files:**
- Modify: the file identified in Task 1 Step 2 (where `config.mcp` legacy strip lives).

- [ ] **Step 1: Add an `issueRefFromPath` strip**

When loading a `WorkflowGraph`, for each `trigger-webhook` node, delete `config.issueRefFromPath` if present. Follow the existing pattern used for `config.mcp` removal. No data is preserved — see spec § Migration.

If no centralised strip exists yet, add the strip in the same path the rest of the load-time normalisation flows through (often the workflow-version read in `packages/api-server/src/routes/flows.ts` or the orchestrator's graph load).

---

## Task 12: UI — remove trigger field, add webhook-wait correlation section

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/trigger-webhook-panel.tsx`
- Modify: `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx`

- [ ] **Step 1: Remove `IssueRef from path (optional)` from trigger-webhook panel**

Delete lines 153-162 in `trigger-webhook-panel.tsx` (the entire `<label>IssueRef from path (optional)…</label>` block). Also remove the `issueRefFromPath` reads/writes in this file. The `trigger-input-paths-${node.id}` datalist (line 157) may still be referenced by inputs mapping — leave the datalist itself in place if so.

- [ ] **Step 2: Add Correlation section to `WebhookWaitConfigEditor.tsx`**

Update the inline `cfg` type:

```ts
import type { CorrelationKey, WorkflowInputValue } from "@journeyman/core";

const cfg = (node.config ?? {}) as {
  webhookId?: string;
  listensFor?: string[];
  acceptIf?: unknown;
  correlationKey?: CorrelationKey;
  outputs?: WebhookWaitOutputCfg[];
  timeout?: { duration: string; defaults?: Record<string, unknown> };
};
```

Render a section between `listensFor` and `acceptIf` (placement determined by the file's existing structure):

```tsx
<fieldset className="je-section">
  <legend>Correlation</legend>
  <p className="je-help">
    When an event arrives, which paused workflow does it belong to? Match the
    event field on the left against a value resolved from this instance.
  </p>

  <label>
    Event path
    <input
      type="text"
      list={datalistId}
      value={cfg.correlationKey?.eventPath ?? ""}
      disabled={readOnly}
      placeholder="$.pull_request.number"
      onChange={(e) => {
        const eventPath = e.target.value;
        const value: WorkflowInputValue =
          cfg.correlationKey?.value ?? { kind: "template", template: "" };
        update({ correlationKey: { eventPath, value } });
      }}
    />
  </label>

  <label>
    Equals (template, e.g. "{{ inputs.ticketId }}")
    <input
      type="text"
      value={
        cfg.correlationKey?.value?.kind === "template"
          ? cfg.correlationKey.value.template
          : cfg.correlationKey?.value?.kind === "literal"
            ? String(cfg.correlationKey.value.value ?? "")
            : ""
      }
      disabled={readOnly}
      placeholder="{{ inputs.ticketId }}"
      onChange={(e) => {
        const template = e.target.value;
        const eventPath = cfg.correlationKey?.eventPath ?? "";
        update({
          correlationKey: {
            eventPath,
            value: { kind: "template", template },
          },
        });
      }}
    />
  </label>
</fieldset>
```

V1 only exposes `template` values; the union remains in the type so `ref`/`literal` can be added later.

---

## Task 13: Final verification — typecheck + import boundaries

**Files:** none

- [ ] **Step 1: Run typecheck and import-boundary check**

```bash
npm run check
```

Expected: exits 0. Fix any errors before declaring done. Common issues to expect:

- Lingering `issueRef` references in core types or stores — remove or update.
- `WorkflowInputValue` not exported from `@journeyman/core` — confirm it's already in `packages/core/src/index.ts` line 113 (yes, per grep results).
- `CorrelationKey` not exported — add to `packages/core/src/index.ts` if needed.

- [ ] **Step 2: Do NOT commit**

Per user constraint — leave changes staged-or-unstaged in the working tree.

---

## Self-review notes

- **Spec coverage:** every spec section is mapped to a task — schema (Task 2), trigger config removal (Tasks 3, 11, 12), wait config addition (Tasks 3, 9, 12), instance-store cleanup (Tasks 4–6), conductor cleanup (Task 8), matcher rewrite (Task 10), validation (Task 7), UI (Task 12), no migration (Task 2 note).
- **Out of scope:** `tags` / cross-instance search and dedupe are intentionally not in any task.
- **NodeExecution interface gap:** Task 4 added `findWaitingByCorrelationValue` to the interface; Task 10 replaced it with `findAllWaitingWithCorrelation`. The final interface has only `findAllWaitingWithCorrelation`. Update Task 4's interface block accordingly when implementing — only add `findAllWaitingWithCorrelation`, not the per-value method.
- **No tests:** per user constraint. Manual exploratory verification of the UI and the end-to-end webhook flow is the engineer's responsibility before claiming done.
- **No commits:** per user constraint. The plan never instructs `git add` or `git commit`.
