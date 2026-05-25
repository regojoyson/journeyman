# Workflow Trigger Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `start` node with a category of trigger nodes (`trigger-manual`, `trigger-webhook`, `trigger-human`); a workflow may declare ≥1 trigger; any one fires a new instance. Webhook ingest gets resume-wins precedence.

**Architecture:** New node types added to `@journeyman/core` with `WORKFLOW_SCHEMA_VERSION` bumped to 2. Workflow inputs lifted off the start node onto `WorkflowGraph`. A denormalized `jm_workflow_triggers` index is maintained on publish/unpublish/promote and read by the webhook-ingest pipeline. Manual trigger reuses the existing run endpoint; human-form trigger adds new in-app form endpoints.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React, Conductor (workflow engine).

**User constraints for this plan:** No commits inside tasks. No unit-test steps. One typecheck/boundaries check at the very end.

**Spec:** [docs/superpowers/specs/2026-05-25-workflow-trigger-nodes-design.md](docs/superpowers/specs/2026-05-25-workflow-trigger-nodes-design.md)

---

## File Map

### Create
- `packages/migrations/src/sql/028_workflow_triggers.sql`
- `packages/core/src/types/workflow-trigger.types.ts`
- `packages/core/src/interfaces/workflow-trigger-store.interface.ts`
- `packages/orchestrator/src/stores/memory/memory-workflow-trigger-store.ts`
- `packages/orchestrator/src/stores/postgres/postgres-workflow-trigger-store.ts`
- `packages/api-server/src/services/workflow-trigger-index.ts`
- `packages/api-server/src/services/webhook-trigger-fire.ts`
- `packages/api-server/src/services/form-submission.ts`
- `packages/api-server/src/routes/forms.ts`
- `packages/api-server/src/routes/workflow-triggers.ts`
- `packages/flow-editor/src/triggers-lane/TriggersLane.tsx`
- `packages/flow-editor/src/triggers-lane/AddTriggerModal.tsx`
- `packages/flow-editor/src/properties-panel/trigger-manual-panel.tsx`
- `packages/flow-editor/src/properties-panel/trigger-webhook-panel.tsx`
- `packages/flow-editor/src/properties-panel/trigger-human-panel.tsx`
- `packages/flow-editor/src/inputs-tab/InputsTab.tsx`
- `packages/web/src/routes/forms/FormsInventoryPage.tsx`
- `packages/web/src/routes/forms/RunFormPage.tsx`
- `packages/web/src/api/forms.ts`
- `packages/web/src/api/workflow-triggers.ts`

### Modify
- `packages/core/src/types/flow.types.ts` (add trigger types, remove `start`, lift inputs, bump schema version)
- `packages/core/src/types/workflow-instance.types.ts` (extend TriggerSource, add triggerNodeId, formSubmissionId)
- `packages/core/src/validation/validate-for-publish.ts` (replace start rules)
- `packages/core/src/validation/validate-ref-shape.ts` (start → trigger-* lookup)
- `packages/core/src/utils/validate-workflow.ts` (start → trigger-* lookup)
- `packages/core/src/interfaces/orchestrator-engine.interface.ts` (extend SubmitWorkflowInstanceArgs)
- `packages/core/src/index.ts` (export new types)
- `packages/orchestrator/src/flow-json/conductor-converter.ts` (v1→v2 read-time migration; trigger-* handled as graph sources)
- `packages/orchestrator/src/flow-json/reachability.ts` (start → trigger-*)
- `packages/orchestrator/src/flow-json/validate-ref-shape.ts` (start → trigger-*)
- `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts` (persist new submit fields)
- `packages/orchestrator/src/composition.ts` (wire workflow trigger store)
- `packages/api-server/src/composition.ts` (wire workflow trigger store)
- `packages/api-server/src/services/webhook-ingest.ts` (resume-wins → trigger branch)
- `packages/api-server/src/routes/flows.ts` (manual run 409 if no trigger-manual; maintain trigger index on publish/unpublish/promote)
- `packages/api-server/src/routes/index.ts` (register new routes)
- `packages/flow-editor/src/state/flow-graph.ts` (start → trigger-*)
- `packages/flow-editor/src/state/validation.ts` (start → trigger-*)
- `packages/flow-editor/src/state/validate-ref-shape.ts` (start → trigger-*)
- `packages/flow-editor/src/properties-panel/use-upstream-sources.ts` (start → trigger-*)
- `packages/flow-editor/src/FlowEditor.tsx` (mount TriggersLane and InputsTab)
- `packages/web/src/App.tsx` (register `/forms` and `/workflows/:id/form` routes)

---

## Task 1: Core type changes (new node types, lifted inputs, schema bump)

**Files:**
- Modify: `packages/core/src/types/flow.types.ts`
- Modify: `packages/core/src/types/workflow-instance.types.ts`
- Modify: `packages/core/src/interfaces/orchestrator-engine.interface.ts`
- Create: `packages/core/src/types/workflow-trigger.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1.1: Add trigger node types to `WorkflowNodeType` and bump schema version**

In `packages/core/src/types/flow.types.ts`, replace lines 9-28:

```ts
export const WORKFLOW_SCHEMA_VERSION = 2 as const;
export type WorkflowSchemaVersion = typeof WORKFLOW_SCHEMA_VERSION;

export type WorkflowNodeType =
  | "trigger-manual"
  | "trigger-webhook"
  | "trigger-human"
  | "end"
  | "step"
  | "human-task"
  | "webhook-wait"
  // reserved for later step types — converter rejects in Phase 1.
  | "gateway-xor"
  | "gateway-and"
  | "join"
  | "loop"
  | "subflow"
  | "if"
  | "timer"
  | "retry-block"
  | "try-catch";

export type WorkflowTriggerNodeType =
  | "trigger-manual"
  | "trigger-webhook"
  | "trigger-human";

export const TRIGGER_NODE_TYPES: readonly WorkflowTriggerNodeType[] = [
  "trigger-manual",
  "trigger-webhook",
  "trigger-human",
] as const;

export function isTriggerNode(node: { type: WorkflowNodeType }): boolean {
  return (TRIGGER_NODE_TYPES as readonly string[]).includes(node.type);
}
```

- [ ] **Step 1.2: Lift `inputs` to `WorkflowGraph`**

Read the current shape of `WorkflowGraph` in `packages/core/src/types/flow.types.ts` (it's defined after `WorkflowEdge`). Locate the `WorkflowGraph` interface — it already has `nodes` and `edges`. Add an `inputs` field. The change is:

```ts
export interface WorkflowGraph {
  schemaVersion: WorkflowSchemaVersion;
  inputs: WorkflowInputDef[];           // NEW — was previously held on start node
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  defaults?: WorkflowDefaults;          // existing — keep as-is if present
}
```

(Preserve any other existing properties on `WorkflowGraph`; only add `inputs`.)

- [ ] **Step 1.3: Create trigger config types**

Create `packages/core/src/types/workflow-trigger.types.ts`:

```ts
import type { JsonLogicExpr } from "./flow-condition.types.ts";

export type TriggerInputMappingType = "string" | "number" | "boolean" | "json";

export interface TriggerInputMapping {
  fromPath: string;                                 // JSONPath into payload
  type: TriggerInputMappingType;
}

export interface TriggerManualConfig {
  // No fields. Manual triggers render the workflow's inputs as a form.
}

export interface TriggerWebhookConfig {
  webhookId: string;
  listensFor?: string[];
  acceptIf?: JsonLogicExpr;
  inputsMapping: Record<string, TriggerInputMapping>;
  issueRefFromPath?: string;
}

export type TriggerHumanFieldWidget =
  | "text"
  | "textarea"
  | "number"
  | "checkbox"
  | "select";

export interface TriggerHumanFieldOverride {
  label?: string;
  description?: string;
  widget?: TriggerHumanFieldWidget;
  options?: string[];                               // only for widget === "select"
}

export interface TriggerHumanConfig {
  formTitle?: string;
  fieldOverrides?: Record<string, TriggerHumanFieldOverride>;
  authorizedRoles?: string[];
}
```

- [ ] **Step 1.4: Extend `WorkflowInstance` and `TriggerSource`**

In `packages/core/src/types/workflow-instance.types.ts`, replace line 12 and add two fields to `WorkflowInstance`:

```ts
export type TriggerSource = "manual" | "webhook" | "schedule" | "api" | "human";
```

Inside `interface WorkflowInstance { ... }`, add (after `webhookEventId: string | null;`):

```ts
  /** ID of the trigger node that started this instance (one of trigger-manual|webhook|human). */
  triggerNodeId: string | null;
  /** When started via trigger-human, the submission id; null otherwise. */
  formSubmissionId: string | null;
```

- [ ] **Step 1.5: Extend `SubmitWorkflowInstanceArgs`**

In `packages/core/src/interfaces/orchestrator-engine.interface.ts`, replace the body of `SubmitWorkflowInstanceArgs` with:

```ts
export interface SubmitWorkflowInstanceArgs {
  workflowId: string | null;
  workflowVersionId: string | null;
  workflowNameSnapshot: string;
  workflowScopeSnapshot: "user" | "org" | "global";
  definitionSnapshot: WorkflowGraph;
  inputs: Record<string, unknown>;
  startedByUserId: string | null;
  startedByOrgId: string | null;
  /** How this instance was started; defaults to "manual" if omitted by the caller. */
  triggerSource?: "manual" | "webhook" | "schedule" | "api" | "human";
  /** The trigger node id that fired (id of the trigger-manual/webhook/human node). */
  triggerNodeId?: string | null;
  /** Webhook event id when triggerSource === "webhook". */
  webhookEventId?: string | null;
  /** Form submission id when triggerSource === "human". */
  formSubmissionId?: string | null;
  /** Optional issueRef for cross-instance correlation (e.g. extracted via trigger-webhook.issueRefFromPath). */
  issueRef?: string | null;
}
```

- [ ] **Step 1.6: Export new types from package root**

In `packages/core/src/index.ts`, add to the existing exports (find the section that re-exports flow.types.ts):

```ts
export type {
  TriggerInputMapping,
  TriggerInputMappingType,
  TriggerManualConfig,
  TriggerWebhookConfig,
  TriggerHumanConfig,
  TriggerHumanFieldOverride,
  TriggerHumanFieldWidget,
} from "./types/workflow-trigger.types.ts";
export {
  WORKFLOW_SCHEMA_VERSION,
  TRIGGER_NODE_TYPES,
  isTriggerNode,
} from "./types/flow.types.ts";
export type { WorkflowTriggerNodeType } from "./types/flow.types.ts";
```

(Adjust the existing flow.types re-export if `WORKFLOW_SCHEMA_VERSION` is already exported — keep one canonical export only.)

---

## Task 2: Migration SQL — `jm_workflow_triggers` table + instance column additions

**Files:**
- Create: `packages/migrations/src/sql/028_workflow_triggers.sql`

- [ ] **Step 2.1: Create migration file**

Create `packages/migrations/src/sql/028_workflow_triggers.sql`:

```sql
-- Adds the trigger index and extends workflow_instances for human/trigger fields.

CREATE TABLE jm_workflow_triggers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id         uuid NOT NULL REFERENCES jm_workflows(id) ON DELETE CASCADE,
  workflow_version_id uuid NOT NULL REFERENCES jm_workflow_versions(id) ON DELETE CASCADE,
  trigger_node_id     text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('manual','webhook','human')),
  webhook_id          uuid NULL REFERENCES jm_webhooks(id) ON DELETE SET NULL,
  is_active           boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_version_id, trigger_node_id)
);

CREATE INDEX idx_jm_workflow_triggers_webhook_active
  ON jm_workflow_triggers (webhook_id)
  WHERE is_active = true AND kind = 'webhook';

CREATE INDEX idx_jm_workflow_triggers_workflow
  ON jm_workflow_triggers (workflow_id);

-- Extend the trigger source enum and add per-instance trigger metadata.
-- trigger_source is stored as a free text column today (verified against
-- WorkflowInstance.triggerSource), so no enum alter is required; the check is
-- enforced at the application layer.

ALTER TABLE jm_workflow_instances
  ADD COLUMN IF NOT EXISTS trigger_node_id text NULL;

ALTER TABLE jm_workflow_instances
  ADD COLUMN IF NOT EXISTS form_submission_id uuid NULL;

-- Optional table for form submissions (lightweight; we just record what came
-- in for audit/debugging). The instance carries the materialized inputs.
CREATE TABLE jm_form_submissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id       uuid NOT NULL REFERENCES jm_workflows(id) ON DELETE CASCADE,
  workflow_version_id uuid NOT NULL REFERENCES jm_workflow_versions(id) ON DELETE CASCADE,
  submitted_by_user_id uuid NULL,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  raw_values        jsonb NOT NULL,
  workflow_instance_id uuid NULL REFERENCES jm_workflow_instances(id) ON DELETE SET NULL
);

CREATE INDEX idx_jm_form_submissions_workflow ON jm_form_submissions (workflow_id);
```

> If `jm_workflow_instances` does not currently have `trigger_source` and `webhook_event_id` columns, locate the original instances migration and follow its column types — but those columns already exist (verified by reading `packages/core/src/types/workflow-instance.types.ts`). The `ADD COLUMN IF NOT EXISTS` guards make this idempotent.

---

## Task 3: Conductor converter + validation updates

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`
- Modify: `packages/orchestrator/src/flow-json/reachability.ts`
- Modify: `packages/orchestrator/src/flow-json/validate-ref-shape.ts`
- Modify: `packages/core/src/validation/validate-for-publish.ts`
- Modify: `packages/core/src/validation/validate-ref-shape.ts`
- Modify: `packages/core/src/utils/validate-workflow.ts`
- Modify: `packages/flow-editor/src/state/flow-graph.ts`
- Modify: `packages/flow-editor/src/state/validation.ts`
- Modify: `packages/flow-editor/src/state/validate-ref-shape.ts`
- Modify: `packages/flow-editor/src/properties-panel/use-upstream-sources.ts`

- [ ] **Step 3.1: Write a shared helper for "find the trigger nodes"**

In `packages/core/src/types/flow.types.ts`, after the `isTriggerNode` function from Step 1.1, append:

```ts
export function findTriggerNodes(flow: { nodes: WorkflowNode[] }): WorkflowNode[] {
  return flow.nodes.filter((n) => isTriggerNode(n));
}

export function findManualTriggerNode(flow: { nodes: WorkflowNode[] }): WorkflowNode | undefined {
  return flow.nodes.find((n) => n.type === "trigger-manual");
}
```

- [ ] **Step 3.2: Update `validate-for-publish.ts`**

In `packages/core/src/validation/validate-for-publish.ts`, locate lines around 83 and 103 that filter/find `start` nodes. Replace the "exactly one start" check with:

```ts
import { findTriggerNodes, isTriggerNode } from "../types/flow.types.ts";

// inside the publish validator, replace the existing start-node block:
const triggers = findTriggerNodes(flow);
if (triggers.length === 0) {
  errors.push({
    code: "no_trigger",
    severity: "error",
    message: "Workflow must declare at least one trigger node (manual, webhook, or human form).",
    nodeId: null,
  });
}
for (const t of triggers) {
  const hasInbound = flow.edges.some((e) => e.target === t.id);
  if (hasInbound) {
    errors.push({
      code: "trigger_has_inbound_edge",
      severity: "error",
      message: `Trigger node "${t.id}" must not have inbound edges.`,
      nodeId: t.id,
    });
  }
}

// trigger-webhook scope check (uses webhook visibility resolution available in this validator's ctx)
for (const t of triggers) {
  if (t.type === "trigger-webhook") {
    const webhookId = (t.config as { webhookId?: string } | undefined)?.webhookId;
    if (!webhookId) {
      errors.push({
        code: "trigger_webhook_missing_webhook",
        severity: "error",
        message: `trigger-webhook "${t.id}" must reference a webhookId.`,
        nodeId: t.id,
      });
    }
  }
}
```

> If `validate-for-publish.ts` does not currently have a webhook-visibility resolver in scope, leave the scope check unimplemented inside the pure validator and rely on the API-server route handler to reject (Task 4 step). The "missing webhookId" check above is pure.

- [ ] **Step 3.3: Replace `start` lookups in pure validators**

In `packages/core/src/validation/validate-ref-shape.ts` and `packages/core/src/utils/validate-workflow.ts`, replace any `n.type === "start"` filter with the helper:

```ts
import { findTriggerNodes } from "../types/flow.types.ts";

// before:  const start = flow.nodes.find((n) => n.type === "start");
// after:
const triggers = findTriggerNodes(flow);
const start = triggers[0] ?? null; // ref-shape only needs *some* graph source for input refs
```

For ref-shape's "available upstream inputs at the start" computation, every trigger contributes the **same** workflow inputs (lifted to graph level), so the source of the inputs is now `flow.inputs` not `start.inputs`. Find the place where `start.inputs` is read and change it to `flow.inputs`.

- [ ] **Step 3.4: Update orchestrator `reachability.ts`**

In `packages/orchestrator/src/flow-json/reachability.ts`, replace:

```ts
const startNode = graph.nodes.find(n => n.type === "start");
```

with:

```ts
import { findTriggerNodes } from "@journeyman/core";

const triggers = findTriggerNodes(graph);
// reachability uses the *union* of nodes reachable from any trigger as the
// "live" set. Every non-trigger node must appear in this union to be reachable.
const reachable = new Set<string>();
for (const t of triggers) {
  const dfs = [t.id];
  while (dfs.length) {
    const id = dfs.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const e of graph.edges) if (e.source === id) dfs.push(e.target);
  }
}
```

Return `reachable` (preserve the function's existing return type — if it returns a set, return `reachable`; if it returns reachable-from-start, adapt callers similarly). If the existing callers expect `startNode`, expose `triggers[0]` for backward compatibility but prefer the union model.

- [ ] **Step 3.5: Update orchestrator ref-shape validator**

In `packages/orchestrator/src/flow-json/validate-ref-shape.ts`, mirror Step 3.3 (use `findTriggerNodes`, source workflow inputs from `flow.inputs`).

- [ ] **Step 3.6: Update Conductor JSON converter — v1→v2 read-time migration + trigger handling**

In `packages/orchestrator/src/flow-json/conductor-converter.ts`:

(a) Add a top-of-class `migrateV1ToV2` step that runs *before* any other graph processing:

```ts
import { WORKFLOW_SCHEMA_VERSION, isTriggerNode } from "@journeyman/core";
import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";

function migrateV1ToV2(raw: WorkflowGraph): WorkflowGraph {
  // v1 detection: presence of any node with type === "start", or schemaVersion < 2.
  const sv = (raw as { schemaVersion?: number }).schemaVersion ?? 1;
  if (sv >= WORKFLOW_SCHEMA_VERSION) return raw;

  const startNode = raw.nodes.find((n: WorkflowNode) => (n.type as string) === "start");
  const liftedInputs =
    (raw as { inputs?: unknown[] }).inputs as unknown[] | undefined
    ?? ((startNode?.inputs ?? []) as unknown[])  // older v1 may have inputs on start
    ?? [];

  const migratedNodes = raw.nodes.map((n: WorkflowNode): WorkflowNode => {
    if ((n.type as string) !== "start") return n;
    return { ...n, type: "trigger-manual", inputs: undefined };
  });

  return {
    ...raw,
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    inputs: liftedInputs as WorkflowGraph["inputs"],
    nodes: migratedNodes,
  };
}
```

(b) In the converter's constructor (or the entry method that first touches `this.flow`), call `this.flow = migrateV1ToV2(this.flow);` before any other logic.

(c) Replace every `n.type === "start"` filter (lines 91, 97, 163) with `isTriggerNode(n)` and adapt:

```ts
// line ~91
const starts = this.flow.nodes.filter(n => isTriggerNode(n));

// line ~97
const startNode = this.flow.nodes.find(n => isTriggerNode(n));

// line ~163
startNode(): WorkflowNode { return this.flow.nodes.find(n => isTriggerNode(n))!; }
```

(d) In the `switch (node.type)` block (line ~195), add cases for the trigger types that emit no engine work (they only declare a graph entry point):

```ts
switch (node.type) {
  case "trigger-manual":
  case "trigger-webhook":
  case "trigger-human":
    // trigger nodes are pure graph entry points; do not emit Conductor tasks.
    return null;
  // ... existing cases ...
}
```

If the existing switch returns a task array, return an empty array instead of `null` to match the type.

- [ ] **Step 3.7: Update flow-editor state helpers**

In `packages/flow-editor/src/state/flow-graph.ts`, `packages/flow-editor/src/state/validation.ts`, `packages/flow-editor/src/state/validate-ref-shape.ts`, and `packages/flow-editor/src/properties-panel/use-upstream-sources.ts`, replace every `n.type === "start"` filter with `isTriggerNode(n)` (import from `@journeyman/core`). For places that previously read `start.inputs`, read `flow.inputs` instead.

---

## Task 4: `jm_workflow_triggers` store + index maintenance

**Files:**
- Create: `packages/core/src/interfaces/workflow-trigger-store.interface.ts`
- Create: `packages/orchestrator/src/stores/memory/memory-workflow-trigger-store.ts`
- Create: `packages/orchestrator/src/stores/postgres/postgres-workflow-trigger-store.ts`
- Create: `packages/api-server/src/services/workflow-trigger-index.ts`
- Modify: `packages/orchestrator/src/composition.ts`
- Modify: `packages/api-server/src/composition.ts`
- Modify: `packages/api-server/src/routes/flows.ts` (publish/unpublish/promote → refresh index)

- [ ] **Step 4.1: Define the store interface**

Create `packages/core/src/interfaces/workflow-trigger-store.interface.ts`:

```ts
export interface WorkflowTriggerIndexRow {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  triggerNodeId: string;
  kind: "manual" | "webhook" | "human";
  webhookId: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface UpsertWorkflowTriggerArgs {
  workflowId: string;
  workflowVersionId: string;
  triggerNodeId: string;
  kind: "manual" | "webhook" | "human";
  webhookId: string | null;
}

export interface IWorkflowTriggerStore {
  /** Replace the full set of trigger rows for a workflow version. */
  replaceForVersion(workflowVersionId: string, rows: UpsertWorkflowTriggerArgs[]): Promise<void>;
  /** Mark only this version's rows active for a workflow; clear is_active on all others for the same workflow. */
  setActiveForWorkflow(workflowId: string, workflowVersionId: string | null): Promise<void>;
  /** Return all active webhook triggers for a given webhookId. */
  findActiveWebhookTriggers(webhookId: string): Promise<WorkflowTriggerIndexRow[]>;
  /** Return all trigger rows for a workflow (any version). */
  listForWorkflow(workflowId: string): Promise<WorkflowTriggerIndexRow[]>;
}
```

Export it from `packages/core/src/index.ts` next to other interface exports.

- [ ] **Step 4.2: In-memory store**

Create `packages/orchestrator/src/stores/memory/memory-workflow-trigger-store.ts`:

```ts
import { randomUUID } from "node:crypto";
import type {
  IWorkflowTriggerStore,
  UpsertWorkflowTriggerArgs,
  WorkflowTriggerIndexRow,
} from "@journeyman/core";

export class MemoryWorkflowTriggerStore implements IWorkflowTriggerStore {
  private rows: WorkflowTriggerIndexRow[] = [];

  async replaceForVersion(workflowVersionId: string, rows: UpsertWorkflowTriggerArgs[]): Promise<void> {
    this.rows = this.rows.filter((r) => r.workflowVersionId !== workflowVersionId);
    for (const a of rows) {
      this.rows.push({
        id: randomUUID(),
        workflowId: a.workflowId,
        workflowVersionId: a.workflowVersionId,
        triggerNodeId: a.triggerNodeId,
        kind: a.kind,
        webhookId: a.webhookId,
        isActive: false,
        createdAt: new Date(),
      });
    }
  }

  async setActiveForWorkflow(workflowId: string, workflowVersionId: string | null): Promise<void> {
    this.rows = this.rows.map((r) => {
      if (r.workflowId !== workflowId) return r;
      return { ...r, isActive: workflowVersionId !== null && r.workflowVersionId === workflowVersionId };
    });
  }

  async findActiveWebhookTriggers(webhookId: string): Promise<WorkflowTriggerIndexRow[]> {
    return this.rows.filter((r) => r.isActive && r.kind === "webhook" && r.webhookId === webhookId);
  }

  async listForWorkflow(workflowId: string): Promise<WorkflowTriggerIndexRow[]> {
    return this.rows.filter((r) => r.workflowId === workflowId);
  }
}
```

- [ ] **Step 4.3: Postgres store**

Create `packages/orchestrator/src/stores/postgres/postgres-workflow-trigger-store.ts`:

```ts
import type { Pool } from "pg";
import type {
  IWorkflowTriggerStore,
  UpsertWorkflowTriggerArgs,
  WorkflowTriggerIndexRow,
} from "@journeyman/core";

function rowToIndex(r: Record<string, unknown>): WorkflowTriggerIndexRow {
  return {
    id: r.id as string,
    workflowId: r.workflow_id as string,
    workflowVersionId: r.workflow_version_id as string,
    triggerNodeId: r.trigger_node_id as string,
    kind: r.kind as "manual" | "webhook" | "human",
    webhookId: (r.webhook_id as string | null) ?? null,
    isActive: r.is_active as boolean,
    createdAt: r.created_at as Date,
  };
}

export class PostgresWorkflowTriggerStore implements IWorkflowTriggerStore {
  constructor(private pool: Pool) {}

  async replaceForVersion(workflowVersionId: string, rows: UpsertWorkflowTriggerArgs[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM jm_workflow_triggers WHERE workflow_version_id = $1`, [workflowVersionId]);
      for (const a of rows) {
        await client.query(
          `INSERT INTO jm_workflow_triggers
             (workflow_id, workflow_version_id, trigger_node_id, kind, webhook_id, is_active)
           VALUES ($1, $2, $3, $4, $5, false)`,
          [a.workflowId, a.workflowVersionId, a.triggerNodeId, a.kind, a.webhookId],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async setActiveForWorkflow(workflowId: string, workflowVersionId: string | null): Promise<void> {
    if (workflowVersionId === null) {
      await this.pool.query(
        `UPDATE jm_workflow_triggers SET is_active = false WHERE workflow_id = $1`,
        [workflowId],
      );
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE jm_workflow_triggers SET is_active = false WHERE workflow_id = $1`,
        [workflowId],
      );
      await client.query(
        `UPDATE jm_workflow_triggers SET is_active = true
         WHERE workflow_id = $1 AND workflow_version_id = $2`,
        [workflowId, workflowVersionId],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async findActiveWebhookTriggers(webhookId: string): Promise<WorkflowTriggerIndexRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_workflow_triggers
       WHERE is_active = true AND kind = 'webhook' AND webhook_id = $1`,
      [webhookId],
    );
    return rows.map(rowToIndex);
  }

  async listForWorkflow(workflowId: string): Promise<WorkflowTriggerIndexRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_workflow_triggers WHERE workflow_id = $1`,
      [workflowId],
    );
    return rows.map(rowToIndex);
  }
}
```

- [ ] **Step 4.4: Wire the store into composition**

In `packages/orchestrator/src/composition.ts` (and the api-server's `composition.ts` if it has its own type), add `workflowTriggers: IWorkflowTriggerStore`. The orchestrator's composition adds:

```ts
import { MemoryWorkflowTriggerStore } from "./stores/memory/memory-workflow-trigger-store.ts";
import { PostgresWorkflowTriggerStore } from "./stores/postgres/postgres-workflow-trigger-store.ts";
import type { IWorkflowTriggerStore } from "@journeyman/core";

// inside the existing composition factory:
const workflowTriggers: IWorkflowTriggerStore = pool
  ? new PostgresWorkflowTriggerStore(pool)
  : new MemoryWorkflowTriggerStore();
```

Add `workflowTriggers` to the returned `Composition` object. The api-server `Composition` type re-exports the orchestrator type, so it picks the field up automatically; if not, mirror the addition there.

- [ ] **Step 4.5: Build the index-maintenance service**

Create `packages/api-server/src/services/workflow-trigger-index.ts`:

```ts
import { isTriggerNode } from "@journeyman/core";
import type {
  IWorkflowTriggerStore,
  UpsertWorkflowTriggerArgs,
  WorkflowGraph,
  WorkflowNode,
} from "@journeyman/core";

function rowsFromGraph(workflowId: string, workflowVersionId: string, graph: WorkflowGraph): UpsertWorkflowTriggerArgs[] {
  const out: UpsertWorkflowTriggerArgs[] = [];
  for (const n of graph.nodes as WorkflowNode[]) {
    if (!isTriggerNode(n)) continue;
    const kind = n.type === "trigger-manual" ? "manual"
              : n.type === "trigger-webhook" ? "webhook"
              : "human";
    const webhookId = kind === "webhook"
      ? ((n.config as { webhookId?: string } | undefined)?.webhookId ?? null)
      : null;
    out.push({
      workflowId,
      workflowVersionId,
      triggerNodeId: n.id,
      kind,
      webhookId,
    });
  }
  return out;
}

export async function refreshTriggerIndexOnPublish(
  store: IWorkflowTriggerStore,
  args: { workflowId: string; workflowVersionId: string; graph: WorkflowGraph },
): Promise<void> {
  const rows = rowsFromGraph(args.workflowId, args.workflowVersionId, args.graph);
  await store.replaceForVersion(args.workflowVersionId, rows);
  await store.setActiveForWorkflow(args.workflowId, args.workflowVersionId);
}

export async function refreshTriggerIndexOnUnpublish(
  store: IWorkflowTriggerStore,
  args: { workflowId: string },
): Promise<void> {
  await store.setActiveForWorkflow(args.workflowId, null);
}

export async function refreshTriggerIndexOnVersionCreated(
  store: IWorkflowTriggerStore,
  args: { workflowId: string; workflowVersionId: string; graph: WorkflowGraph },
): Promise<void> {
  // Recompute rows for the new version, but do not mark active. Activation
  // happens on publish.
  const rows = rowsFromGraph(args.workflowId, args.workflowVersionId, args.graph);
  await store.replaceForVersion(args.workflowVersionId, rows);
}
```

- [ ] **Step 4.6: Hook into publish/unpublish/promote in `flows.ts`**

In `packages/api-server/src/routes/flows.ts`:

(a) Locate the publish handler (around line 580 where `c.workflows.setStatus(id, "ready")` is called). Immediately after the `setStatus` call, before `return`:

```ts
import {
  refreshTriggerIndexOnPublish,
  refreshTriggerIndexOnUnpublish,
  refreshTriggerIndexOnVersionCreated,
} from "../services/workflow-trigger-index.ts";

// after setStatus(id, "ready"):
if (updated.currentVersionId) {
  const version = await c.workflowVersions.getById(updated.currentVersionId);
  if (version) {
    await refreshTriggerIndexOnPublish(c.workflowTriggers, {
      workflowId: updated.id,
      workflowVersionId: version.id,
      graph: version.definition,
    });
  }
}
```

(b) In the unpublish handler (line ~586, after `setStatus(id, "draft")`):

```ts
await refreshTriggerIndexOnUnpublish(c.workflowTriggers, { workflowId: id });
```

(c) In any version-create or version-promote handler (search for `workflowVersions.create` in this file), after the new version row is persisted:

```ts
await refreshTriggerIndexOnVersionCreated(c.workflowTriggers, {
  workflowId: newVersion.workflowId,
  workflowVersionId: newVersion.id,
  graph: newVersion.definition,
});
```

(d) **Reject manual run if no `trigger-manual` exists.** In the run handler at line 608 (`POST /workflows/:id/workflow-instances`), insert after the version is loaded (around line 619):

```ts
import { findManualTriggerNode } from "@journeyman/core";

const manualTrigger = findManualTriggerNode(version.definition);
if (!manualTrigger) {
  reply.code(409);
  return { error: "no_manual_trigger" };
}
```

And pass the trigger node id and source on submit:

```ts
const { workflowInstanceId, engineWorkflowId } = await c.orchestrator.submit({
  workflowId: workflow.id,
  workflowVersionId: version.id,
  workflowNameSnapshot: workflow.name,
  workflowScopeSnapshot: workflow.scope,
  definitionSnapshot: version.definition,
  inputs: body.inputs,
  startedByUserId: caller.userId,
  startedByOrgId: ctx.org.id,
  triggerSource: "manual",
  triggerNodeId: manualTrigger.id,
});
```

---

## Task 5: Webhook ingest — resume-wins → trigger branch

**Files:**
- Create: `packages/api-server/src/services/webhook-trigger-fire.ts`
- Modify: `packages/api-server/src/services/webhook-ingest.ts`

- [ ] **Step 5.1: Build the trigger-fire helper**

Create `packages/api-server/src/services/webhook-trigger-fire.ts`:

```ts
import { evaluate as evaluateJsonLogic } from "../services/jsonlogic.ts"; // adjust to actual export
import { getByPath } from "./jsonpath.ts";
import type { Composition } from "../composition.ts";
import type {
  TriggerWebhookConfig,
  Webhook,
  WorkflowNode,
} from "@journeyman/core";

export interface TriggerFireInput {
  webhook: Webhook;
  eventId: string;
  eventType: string | null;
  rawPayload: unknown;
}

export interface TriggerFireResult {
  fired: number;
  workflowInstanceIds: string[];
}

function coerce(value: unknown, type: "string" | "number" | "boolean" | "json"): unknown {
  if (value == null) return value;
  switch (type) {
    case "string": return String(value);
    case "number": return Number(value);
    case "boolean": return Boolean(value);
    case "json":   return value;
  }
}

export async function fireWebhookTriggers(
  c: Composition,
  input: TriggerFireInput,
): Promise<TriggerFireResult> {
  const rows = await c.workflowTriggers.findActiveWebhookTriggers(input.webhook.id);
  if (rows.length === 0) return { fired: 0, workflowInstanceIds: [] };

  const fired: string[] = [];

  for (const row of rows) {
    const workflow = await c.workflows.getById(row.workflowId);
    if (!workflow || workflow.status !== "ready" || workflow.currentVersionId !== row.workflowVersionId) continue;
    const version = await c.workflowVersions.getById(row.workflowVersionId);
    if (!version) continue;

    const node = version.definition.nodes.find((n: WorkflowNode) => n.id === row.triggerNodeId);
    if (!node || node.type !== "trigger-webhook") continue;
    const cfg = (node.config ?? {}) as TriggerWebhookConfig;

    if (cfg.listensFor && input.eventType && !cfg.listensFor.includes(input.eventType)) continue;
    if (cfg.acceptIf) {
      const data = (input.rawPayload ?? {}) as Record<string, unknown>;
      const ok = c.conditions.evaluate(cfg.acceptIf as unknown, data);
      if (!ok) continue;
    }

    const inputs: Record<string, unknown> = {};
    for (const [name, mapping] of Object.entries(cfg.inputsMapping ?? {})) {
      const v = getByPath(input.rawPayload, mapping.fromPath);
      if (v != null) inputs[name] = coerce(v, mapping.type);
    }
    const issueRef = cfg.issueRefFromPath
      ? (getByPath(input.rawPayload, cfg.issueRefFromPath) as string | null | undefined) ?? null
      : null;

    const { workflowInstanceId } = await c.orchestrator.submit({
      workflowId: workflow.id,
      workflowVersionId: version.id,
      workflowNameSnapshot: workflow.name,
      workflowScopeSnapshot: workflow.scope,
      definitionSnapshot: version.definition,
      inputs,
      startedByUserId: null,
      startedByOrgId: workflow.scope === "org" ? (workflow.ownerOrgId ?? null) : null,
      triggerSource: "webhook",
      triggerNodeId: node.id,
      webhookEventId: input.eventId,
      issueRef,
    });
    fired.push(workflowInstanceId);
  }

  return { fired: fired.length, workflowInstanceIds: fired };
}
```

> If `c.conditions.evaluate` is not on Composition (verify by reading `packages/api-server/src/composition.ts`), reuse whatever JSONLogic helper `match-human-tasks.ts` uses (look at its imports — likely `c.conditions.evaluate`).
>
> If `workflow.ownerOrgId` isn't the actual field name, search the Workflow type for the org-owner field and substitute. Falling back to `null` is safe — `startedByOrgId` is nullable.

- [ ] **Step 5.2: Extend `ingestForWebhook` with the trigger branch**

In `packages/api-server/src/services/webhook-ingest.ts`, after the existing `matchAndResolveWebhookWaits` call returns its result, add the trigger branch.

Locate where the existing code does something like:

```ts
const matchResult = await matchAndResolveWebhookWaits(c, evInfo);
// ... if matched > 0, return "resolved"
```

Immediately after the matched-zero path (where the function currently sets status to "processed" or "ignored"), insert:

```ts
import { fireWebhookTriggers } from "./webhook-trigger-fire.ts";

if (matchResult.matched === 0) {
  const tr = await fireWebhookTriggers(c, {
    webhook,
    eventId: event.id,
    eventType,
    rawPayload: input.rawPayload,
  });
  if (tr.fired > 0) {
    await c.webhookEvents.setStatus(event.id, "processed", null);
    return { status: "resolved", matched: tr.fired, eventId: event.id };
  }
}
```

(Pattern-match the exact return shape used in this file; the existing `IngestResult` union already has `resolved` and `processed` — use `resolved` to signal "we did something with the event".)

> If `c.webhookEvents.setStatus` is not the exact API (verify by reading `packages/api-server/src/services/match-human-tasks.ts` for how it sets status after resume), follow whatever pattern that file uses to mark the event processed.

---

## Task 6: Human form — endpoints + submission service

**Files:**
- Create: `packages/api-server/src/services/form-submission.ts`
- Create: `packages/api-server/src/routes/forms.ts`
- Modify: `packages/api-server/src/routes/index.ts`

- [ ] **Step 6.1: Build the form-submission service**

Create `packages/api-server/src/services/form-submission.ts`:

```ts
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type {
  TriggerHumanConfig,
  Workflow,
  WorkflowGraph,
  WorkflowInputDef,
  WorkflowNode,
} from "@journeyman/core";
import type { Composition } from "../composition.ts";

export interface ResolvedFormSchema {
  workflowId: string;
  workflowVersionId: string;
  title: string;
  fields: Array<{
    name: string;
    type: WorkflowInputDef["type"];
    required: boolean;
    label: string;
    description?: string;
    widget: "text" | "textarea" | "number" | "checkbox" | "select";
    options?: string[];
  }>;
}

function pickHumanTrigger(graph: WorkflowGraph): WorkflowNode | undefined {
  return graph.nodes.find((n) => n.type === "trigger-human");
}

function widgetFor(type: WorkflowInputDef["type"]): "text" | "textarea" | "number" | "checkbox" | "select" {
  switch (type) {
    case "number":  return "number";
    case "boolean": return "checkbox";
    case "json":    return "textarea";
    case "string":
    default:        return "text";
  }
}

export function resolveFormSchema(workflow: Workflow, version: { id: string; definition: WorkflowGraph }): ResolvedFormSchema | null {
  const trigger = pickHumanTrigger(version.definition);
  if (!trigger) return null;
  const cfg = (trigger.config ?? {}) as TriggerHumanConfig;
  const overrides = cfg.fieldOverrides ?? {};

  const fields = version.definition.inputs.map((inp): ResolvedFormSchema["fields"][number] => {
    const o = overrides[inp.name] ?? {};
    return {
      name: inp.name,
      type: inp.type,
      required: inp.required === true,
      label: o.label ?? inp.name,
      description: o.description ?? inp.description,
      widget: o.widget ?? widgetFor(inp.type),
      options: o.options,
    };
  });

  return {
    workflowId: workflow.id,
    workflowVersionId: version.id,
    title: cfg.formTitle ?? workflow.name,
    fields,
  };
}

function coerceInput(value: unknown, type: WorkflowInputDef["type"]): unknown {
  if (value == null) return value;
  switch (type) {
    case "number":  return typeof value === "number" ? value : Number(value);
    case "boolean": return Boolean(value);
    case "json":    return typeof value === "string" ? JSON.parse(value) : value;
    case "string":
    default:        return String(value);
  }
}

export interface FormSubmitArgs {
  workflow: Workflow;
  version: { id: string; definition: WorkflowGraph };
  submittedByUserId: string | null;
  values: Record<string, unknown>;
}

export interface FormSubmitResult {
  workflowInstanceId: string;
  formSubmissionId: string;
}

export async function submitForm(
  c: Composition,
  pool: Pool | null,
  args: FormSubmitArgs,
): Promise<FormSubmitResult> {
  const trigger = pickHumanTrigger(args.version.definition);
  if (!trigger) throw new Error("workflow has no trigger-human node");

  const errors: string[] = [];
  const coerced: Record<string, unknown> = {};
  for (const inp of args.version.definition.inputs) {
    const raw = args.values[inp.name];
    if (raw == null || raw === "") {
      if (inp.required) errors.push(`missing required input "${inp.name}"`);
      continue;
    }
    try {
      coerced[inp.name] = coerceInput(raw, inp.type);
    } catch (e) {
      errors.push(`invalid value for "${inp.name}": ${(e as Error).message}`);
    }
  }
  if (errors.length) throw new Error(errors.join("; "));

  const submissionId = randomUUID();
  if (pool) {
    await pool.query(
      `INSERT INTO jm_form_submissions
         (id, workflow_id, workflow_version_id, submitted_by_user_id, raw_values)
       VALUES ($1, $2, $3, $4, $5)`,
      [submissionId, args.workflow.id, args.version.id, args.submittedByUserId, coerced],
    );
  }

  const { workflowInstanceId } = await c.orchestrator.submit({
    workflowId: args.workflow.id,
    workflowVersionId: args.version.id,
    workflowNameSnapshot: args.workflow.name,
    workflowScopeSnapshot: args.workflow.scope,
    definitionSnapshot: args.version.definition,
    inputs: coerced,
    startedByUserId: args.submittedByUserId,
    startedByOrgId: null,
    triggerSource: "human",
    triggerNodeId: trigger.id,
    formSubmissionId: submissionId,
  });

  if (pool) {
    await pool.query(
      `UPDATE jm_form_submissions SET workflow_instance_id = $1 WHERE id = $2`,
      [workflowInstanceId, submissionId],
    );
  }

  return { workflowInstanceId, formSubmissionId: submissionId };
}
```

- [ ] **Step 6.2: Form routes**

Create `packages/api-server/src/routes/forms.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { resolveFormSchema, submitForm } from "../services/form-submission.ts";
import { requireAuth } from "../middleware/require-auth.ts"; // verify actual import path

export function registerFormRoutes(app: FastifyInstance, c: Composition): void {
  app.get("/me/forms", { preHandler: requireAuth() }, async (req) => {
    const ctx = req.runContext!;
    const workflows = await c.workflows.listVisibleTo({
      userId: ctx.user?.id ?? null,
      orgId: ctx.org?.id ?? null,
    });
    const out: Array<{ workflowId: string; name: string; title: string }> = [];
    for (const wf of workflows) {
      if (wf.status !== "ready" || !wf.currentVersionId) continue;
      const v = await c.workflowVersions.getById(wf.currentVersionId);
      if (!v) continue;
      const schema = resolveFormSchema(wf, v);
      if (!schema) continue;
      out.push({ workflowId: wf.id, name: wf.name, title: schema.title });
    }
    return { forms: out };
  });

  app.get("/workflows/:id/form", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const wf = await c.workflows.getById(id);
    if (!wf) { reply.code(404); return { error: "not_found" }; }
    if (wf.status !== "ready" || !wf.currentVersionId) {
      reply.code(409); return { error: "workflow_not_ready" };
    }
    const v = await c.workflowVersions.getById(wf.currentVersionId);
    if (!v) { reply.code(500); return { error: "version_missing" }; }
    const schema = resolveFormSchema(wf, v);
    if (!schema) { reply.code(404); return { error: "no_human_trigger" }; }
    return { form: schema };
  });

  app.post("/workflows/:id/form-submissions", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { values?: Record<string, unknown> };
    const ctx = req.runContext!;

    const wf = await c.workflows.getById(id);
    if (!wf) { reply.code(404); return { error: "not_found" }; }
    if (wf.status !== "ready" || !wf.currentVersionId) {
      reply.code(409); return { error: "workflow_not_ready" };
    }
    const v = await c.workflowVersions.getById(wf.currentVersionId);
    if (!v) { reply.code(500); return { error: "version_missing" }; }

    try {
      const result = await submitForm(c, c.pool, {
        workflow: wf,
        version: v,
        submittedByUserId: ctx.user?.id ?? null,
        values: body.values ?? {},
      });
      reply.code(202);
      return result;
    } catch (e) {
      reply.code(400);
      return { error: "invalid_submission", reason: (e as Error).message };
    }
  });
}
```

> Verify the actual `requireAuth` import path and `c.workflows.listVisibleTo` method name by reading `packages/api-server/src/routes/flows.ts`. If `listVisibleTo` doesn't exist, use `c.workflows.list` and filter by scope.

- [ ] **Step 6.3: Register routes**

In `packages/api-server/src/routes/index.ts` (or wherever routes are mounted — check `flows.ts` registration), import and call `registerFormRoutes(app, c);`.

---

## Task 7: Triggers summary route

**Files:**
- Create: `packages/api-server/src/routes/workflow-triggers.ts`
- Modify: `packages/api-server/src/routes/index.ts`

- [ ] **Step 7.1: Route**

Create `packages/api-server/src/routes/workflow-triggers.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { isTriggerNode } from "@journeyman/core";
import { requireAuth } from "../middleware/require-auth.ts";

export function registerWorkflowTriggersRoute(app: FastifyInstance, c: Composition): void {
  app.get("/workflows/:id/triggers", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const wf = await c.workflows.getById(id);
    if (!wf) { reply.code(404); return { error: "not_found" }; }

    const versionId = wf.currentVersionId;
    const version = versionId ? await c.workflowVersions.getById(versionId) : null;
    const triggers = (version?.definition.nodes ?? []).filter(isTriggerNode);

    const summaries = await Promise.all(triggers.map(async (t) => {
      const base = { id: t.id, type: t.type as "trigger-manual" | "trigger-webhook" | "trigger-human" };
      if (t.type === "trigger-webhook") {
        const cfg = (t.config ?? {}) as { webhookId?: string };
        const wh = cfg.webhookId ? await c.webhooks.getById(cfg.webhookId) : null;
        return { ...base, webhook: wh ? { id: wh.id, name: wh.name } : null };
      }
      return base;
    }));

    return { triggers: summaries };
  });
}
```

Register it in `packages/api-server/src/routes/index.ts`.

---

## Task 8: Flow editor — TriggersLane + AddTriggerModal

**Files:**
- Create: `packages/flow-editor/src/triggers-lane/TriggersLane.tsx`
- Create: `packages/flow-editor/src/triggers-lane/AddTriggerModal.tsx`
- Modify: `packages/flow-editor/src/FlowEditor.tsx`

- [ ] **Step 8.1: AddTriggerModal**

Create `packages/flow-editor/src/triggers-lane/AddTriggerModal.tsx`:

```tsx
import * as React from "react";

export type AddTriggerKind = "trigger-manual" | "trigger-webhook" | "trigger-human";

interface Props {
  open: boolean;
  existingTypes: AddTriggerKind[];
  onClose: () => void;
  onPick: (kind: AddTriggerKind) => void;
}

const TILE_DEFS: Array<{ kind: AddTriggerKind; title: string; description: string }> = [
  { kind: "trigger-manual",  title: "Manual run", description: "Start by clicking the Run button or via API." },
  { kind: "trigger-webhook", title: "Webhook",    description: "Start when a configured webhook receives a matching event." },
  { kind: "trigger-human",   title: "Human form", description: "Start when a person submits an in-app form." },
];

export function AddTriggerModal({ open, existingTypes, onClose, onPick }: Props): JSX.Element | null {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" className="jm-modal-overlay" onClick={onClose}>
      <div className="jm-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add trigger</h2>
        <div className="jm-trigger-tiles">
          {TILE_DEFS.map((t) => {
            const disabled = t.kind === "trigger-manual" && existingTypes.includes("trigger-manual");
            return (
              <button
                key={t.kind}
                disabled={disabled}
                className="jm-trigger-tile"
                onClick={() => onPick(t.kind)}
              >
                <div className="jm-trigger-tile-title">{t.title}</div>
                <div className="jm-trigger-tile-desc">{t.description}</div>
                {disabled ? <div className="jm-trigger-tile-disabled">Only one manual trigger allowed</div> : null}
              </button>
            );
          })}
        </div>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8.2: TriggersLane**

Create `packages/flow-editor/src/triggers-lane/TriggersLane.tsx`:

```tsx
import * as React from "react";
import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";
import { isTriggerNode } from "@journeyman/core";
import { AddTriggerModal, type AddTriggerKind } from "./AddTriggerModal.tsx";

interface Props {
  graph: WorkflowGraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onAddTrigger: (kind: AddTriggerKind) => void;
  onDeleteTrigger: (nodeId: string) => void;
}

export function TriggersLane({ graph, selectedNodeId, onSelectNode, onAddTrigger, onDeleteTrigger }: Props): JSX.Element {
  const [modalOpen, setModalOpen] = React.useState(false);
  const triggers = graph.nodes.filter(isTriggerNode);
  const existingTypes = triggers.map((t) => t.type as AddTriggerKind);

  return (
    <div className="jm-triggers-lane">
      <div className="jm-triggers-lane-header">
        <span>Triggers</span>
        <button onClick={() => setModalOpen(true)}>+ Add trigger</button>
      </div>
      <div className="jm-triggers-lane-tiles">
        {triggers.map((t: WorkflowNode) => (
          <div
            key={t.id}
            className={`jm-trigger-node-tile ${t.id === selectedNodeId ? "selected" : ""}`}
            onClick={() => onSelectNode(t.id)}
          >
            <div className="jm-trigger-node-title">
              {t.type === "trigger-manual" ? "▶ Manual" :
               t.type === "trigger-webhook" ? "🪝 Webhook" :
               "📝 Human form"}
            </div>
            <div className="jm-trigger-node-label">{t.displayName ?? t.id}</div>
            <button
              className="jm-trigger-node-delete"
              onClick={(e) => { e.stopPropagation(); onDeleteTrigger(t.id); }}
              aria-label="Delete trigger"
            >×</button>
          </div>
        ))}
        {triggers.length === 0 ? (
          <div className="jm-triggers-empty">No triggers yet — click "+ Add trigger" to start.</div>
        ) : null}
      </div>
      <AddTriggerModal
        open={modalOpen}
        existingTypes={existingTypes}
        onClose={() => setModalOpen(false)}
        onPick={(kind) => { setModalOpen(false); onAddTrigger(kind); }}
      />
    </div>
  );
}
```

- [ ] **Step 8.3: Mount TriggersLane in FlowEditor**

In `packages/flow-editor/src/FlowEditor.tsx`, locate the top of the canvas render. Render `<TriggersLane … />` above the existing canvas. Wire up the props from the editor's existing graph-mutation hooks. The graph-mutation handlers must:

- For `onAddTrigger(kind)`: append a new node to `graph.nodes` with a generated id (`crypto.randomUUID()`), `type: kind`, empty `config: {}`, and `position: { x: 0, y: 0 }` (top of canvas). Add a default edge from the new trigger to the previously-selected entry point if one exists; otherwise leave it unconnected.
- For `onDeleteTrigger(nodeId)`: remove the node and any edges where `source === nodeId`.

If the editor uses a reducer or zustand store, add the corresponding actions there following existing patterns (search for `addNode` / `removeNode` actions already in the codebase).

---

## Task 9: Properties panels per trigger type + workflow-level Inputs tab

**Files:**
- Create: `packages/flow-editor/src/properties-panel/trigger-manual-panel.tsx`
- Create: `packages/flow-editor/src/properties-panel/trigger-webhook-panel.tsx`
- Create: `packages/flow-editor/src/properties-panel/trigger-human-panel.tsx`
- Create: `packages/flow-editor/src/inputs-tab/InputsTab.tsx`
- Modify: `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx` (or whichever file routes by node type)
- Modify: `packages/flow-editor/src/FlowEditor.tsx`

- [ ] **Step 9.1: TriggerManualPanel**

Create `packages/flow-editor/src/properties-panel/trigger-manual-panel.tsx`:

```tsx
import * as React from "react";
import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";

interface Props {
  node: WorkflowNode;
  graph: WorkflowGraph;
}

export function TriggerManualPanel({ node, graph }: Props): JSX.Element {
  return (
    <div className="jm-properties-panel-section">
      <h3>Manual trigger</h3>
      <p>Fires when a user clicks Run, or via <code>POST /workflows/:id/workflow-instances</code>.</p>
      <h4>Form preview</h4>
      {graph.inputs.length === 0 ? (
        <p>This workflow has no inputs. The Run form will be empty.</p>
      ) : (
        <ul>
          {graph.inputs.map((inp) => (
            <li key={inp.name}>
              <strong>{inp.name}</strong> <em>({inp.type})</em>
              {inp.required ? " — required" : ""}
              {inp.description ? ` — ${inp.description}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 9.2: TriggerWebhookPanel**

Create `packages/flow-editor/src/properties-panel/trigger-webhook-panel.tsx`:

```tsx
import * as React from "react";
import type { TriggerWebhookConfig, WorkflowGraph, WorkflowNode } from "@journeyman/core";

interface WebhookOption { id: string; name: string }

interface Props {
  node: WorkflowNode;
  graph: WorkflowGraph;
  webhooks: WebhookOption[];                  // fetched by parent via GET /webhooks
  onPatchConfig: (patch: Partial<TriggerWebhookConfig>) => void;
}

export function TriggerWebhookPanel({ node, graph, webhooks, onPatchConfig }: Props): JSX.Element {
  const cfg = (node.config ?? {}) as TriggerWebhookConfig;

  return (
    <div className="jm-properties-panel-section">
      <h3>Webhook trigger</h3>

      <label>
        Webhook
        <select
          value={cfg.webhookId ?? ""}
          onChange={(e) => onPatchConfig({ webhookId: e.target.value || undefined })}
        >
          <option value="">— select —</option>
          {webhooks.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </label>

      <label>
        Listens for (event types, comma-separated; empty = all)
        <input
          type="text"
          value={(cfg.listensFor ?? []).join(", ")}
          onChange={(e) => {
            const v = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
            onPatchConfig({ listensFor: v.length ? v : undefined });
          }}
        />
      </label>

      <label>
        Accept-if (JSONLogic — JSON)
        <textarea
          rows={4}
          value={cfg.acceptIf ? JSON.stringify(cfg.acceptIf, null, 2) : ""}
          onChange={(e) => {
            try { onPatchConfig({ acceptIf: e.target.value ? JSON.parse(e.target.value) : undefined }); }
            catch { /* keep editing */ }
          }}
        />
      </label>

      <h4>Inputs mapping</h4>
      {graph.inputs.length === 0 ? (
        <p>No workflow inputs declared. Add inputs in the Inputs tab first.</p>
      ) : (
        <table>
          <thead><tr><th>Input</th><th>From path</th><th>Type</th></tr></thead>
          <tbody>
            {graph.inputs.map((inp) => {
              const m = (cfg.inputsMapping ?? {})[inp.name];
              return (
                <tr key={inp.name}>
                  <td>{inp.name}{inp.required ? " *" : ""}</td>
                  <td>
                    <input
                      type="text"
                      placeholder="$.path.to.value"
                      value={m?.fromPath ?? ""}
                      onChange={(e) => {
                        const next = { ...(cfg.inputsMapping ?? {}) };
                        next[inp.name] = { fromPath: e.target.value, type: (m?.type ?? "string") };
                        onPatchConfig({ inputsMapping: next });
                      }}
                    />
                  </td>
                  <td>
                    <select
                      value={m?.type ?? inp.type}
                      onChange={(e) => {
                        const next = { ...(cfg.inputsMapping ?? {}) };
                        next[inp.name] = { fromPath: m?.fromPath ?? "", type: e.target.value as "string"|"number"|"boolean"|"json" };
                        onPatchConfig({ inputsMapping: next });
                      }}
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                      <option value="json">json</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <label>
        IssueRef from path (optional)
        <input
          type="text"
          value={cfg.issueRefFromPath ?? ""}
          onChange={(e) => onPatchConfig({ issueRefFromPath: e.target.value || undefined })}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 9.3: TriggerHumanPanel**

Create `packages/flow-editor/src/properties-panel/trigger-human-panel.tsx`:

```tsx
import * as React from "react";
import type { TriggerHumanConfig, WorkflowGraph, WorkflowNode } from "@journeyman/core";

interface Props {
  node: WorkflowNode;
  graph: WorkflowGraph;
  onPatchConfig: (patch: Partial<TriggerHumanConfig>) => void;
}

export function TriggerHumanPanel({ node, graph, onPatchConfig }: Props): JSX.Element {
  const cfg = (node.config ?? {}) as TriggerHumanConfig;
  const overrides = cfg.fieldOverrides ?? {};

  return (
    <div className="jm-properties-panel-section">
      <h3>Human form trigger</h3>

      <label>
        Form title
        <input
          type="text"
          value={cfg.formTitle ?? ""}
          onChange={(e) => onPatchConfig({ formTitle: e.target.value || undefined })}
        />
      </label>

      <h4>Field overrides</h4>
      {graph.inputs.length === 0 ? (
        <p>No workflow inputs declared. Add inputs in the Inputs tab first.</p>
      ) : graph.inputs.map((inp) => {
        const o = overrides[inp.name] ?? {};
        return (
          <fieldset key={inp.name}>
            <legend>{inp.name} <em>({inp.type})</em></legend>
            <label>Label
              <input
                type="text"
                value={o.label ?? ""}
                onChange={(e) => {
                  const next = { ...overrides, [inp.name]: { ...o, label: e.target.value || undefined } };
                  onPatchConfig({ fieldOverrides: next });
                }}
              />
            </label>
            <label>Description
              <input
                type="text"
                value={o.description ?? ""}
                onChange={(e) => {
                  const next = { ...overrides, [inp.name]: { ...o, description: e.target.value || undefined } };
                  onPatchConfig({ fieldOverrides: next });
                }}
              />
            </label>
            <label>Widget
              <select
                value={o.widget ?? ""}
                onChange={(e) => {
                  const w = e.target.value as TriggerHumanConfig["fieldOverrides"] extends infer T ? T extends Record<string, infer F> ? F extends { widget?: infer W } ? W : never : never : never;
                  const next = { ...overrides, [inp.name]: { ...o, widget: (e.target.value || undefined) as typeof o.widget } };
                  onPatchConfig({ fieldOverrides: next });
                }}
              >
                <option value="">(default)</option>
                <option value="text">text</option>
                <option value="textarea">textarea</option>
                <option value="number">number</option>
                <option value="checkbox">checkbox</option>
                <option value="select">select</option>
              </select>
            </label>
            {o.widget === "select" ? (
              <label>Options (comma-separated)
                <input
                  type="text"
                  value={(o.options ?? []).join(", ")}
                  onChange={(e) => {
                    const opts = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                    const next = { ...overrides, [inp.name]: { ...o, options: opts.length ? opts : undefined } };
                    onPatchConfig({ fieldOverrides: next });
                  }}
                />
              </label>
            ) : null}
          </fieldset>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 9.4: Route by node type in PropertiesPanel**

In the existing `PropertiesPanel.tsx` (the component that switches by `selectedNode.type`), add three new cases:

```tsx
case "trigger-manual":
  return <TriggerManualPanel node={node} graph={graph} />;
case "trigger-webhook":
  return <TriggerWebhookPanel node={node} graph={graph} webhooks={webhooks} onPatchConfig={patchCfg} />;
case "trigger-human":
  return <TriggerHumanPanel node={node} graph={graph} onPatchConfig={patchCfg} />;
```

`webhooks` is fetched by the panel host via `GET /webhooks` (look at how other panels fetch webhook lists today — e.g. `WebhookSchemaTab.tsx`). `patchCfg` is the existing helper that mutates `node.config`.

- [ ] **Step 9.5: Workflow-level InputsTab**

Create `packages/flow-editor/src/inputs-tab/InputsTab.tsx`:

```tsx
import * as React from "react";
import type { WorkflowInputDef, WorkflowGraph } from "@journeyman/core";

interface Props {
  graph: WorkflowGraph;
  onPatchInputs: (next: WorkflowInputDef[]) => void;
}

export function InputsTab({ graph, onPatchInputs }: Props): JSX.Element {
  const inputs = graph.inputs;

  function update(idx: number, patch: Partial<WorkflowInputDef>): void {
    const next = inputs.map((inp, i) => (i === idx ? { ...inp, ...patch } : inp));
    onPatchInputs(next);
  }
  function add(): void {
    onPatchInputs([...inputs, { name: `input_${inputs.length + 1}`, type: "string", required: false }]);
  }
  function remove(idx: number): void {
    onPatchInputs(inputs.filter((_, i) => i !== idx));
  }

  return (
    <div className="jm-inputs-tab">
      <h2>Workflow inputs</h2>
      <p>All triggers map their source data onto these inputs.</p>
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th><th></th></tr></thead>
        <tbody>
          {inputs.map((inp, idx) => (
            <tr key={idx}>
              <td><input value={inp.name} onChange={(e) => update(idx, { name: e.target.value })} /></td>
              <td>
                <select value={inp.type} onChange={(e) => update(idx, { type: e.target.value as WorkflowInputDef["type"] })}>
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="json">json</option>
                </select>
              </td>
              <td><input type="checkbox" checked={inp.required === true} onChange={(e) => update(idx, { required: e.target.checked })} /></td>
              <td><input value={inp.description ?? ""} onChange={(e) => update(idx, { description: e.target.value || undefined })} /></td>
              <td><button onClick={() => remove(idx)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={add}>+ Add input</button>
    </div>
  );
}
```

Mount `<InputsTab>` in `FlowEditor.tsx` alongside the canvas — add a tab bar with "Canvas | Inputs" if not already present.

---

## Task 10: Web — forms inventory + run form page + workflow detail header

**Files:**
- Create: `packages/web/src/api/forms.ts`
- Create: `packages/web/src/api/workflow-triggers.ts`
- Create: `packages/web/src/routes/forms/FormsInventoryPage.tsx`
- Create: `packages/web/src/routes/forms/RunFormPage.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 10.1: API client wrappers**

Create `packages/web/src/api/forms.ts`:

```ts
import { apiFetch } from "./client.ts"; // verify actual fetch helper

export interface FormListItem { workflowId: string; name: string; title: string }
export interface FormField {
  name: string;
  type: "string" | "number" | "boolean" | "json";
  required: boolean;
  label: string;
  description?: string;
  widget: "text" | "textarea" | "number" | "checkbox" | "select";
  options?: string[];
}
export interface FormSchema {
  workflowId: string;
  workflowVersionId: string;
  title: string;
  fields: FormField[];
}

export async function listMyForms(): Promise<FormListItem[]> {
  const r = await apiFetch<{ forms: FormListItem[] }>("/me/forms");
  return r.forms;
}
export async function getForm(workflowId: string): Promise<FormSchema> {
  const r = await apiFetch<{ form: FormSchema }>(`/workflows/${workflowId}/form`);
  return r.form;
}
export async function submitForm(workflowId: string, values: Record<string, unknown>): Promise<{ workflowInstanceId: string; formSubmissionId: string }> {
  return apiFetch(`/workflows/${workflowId}/form-submissions`, { method: "POST", body: JSON.stringify({ values }) });
}
```

Create `packages/web/src/api/workflow-triggers.ts`:

```ts
import { apiFetch } from "./client.ts";

export interface TriggerSummary {
  id: string;
  type: "trigger-manual" | "trigger-webhook" | "trigger-human";
  webhook?: { id: string; name: string } | null;
}

export async function getWorkflowTriggers(workflowId: string): Promise<TriggerSummary[]> {
  const r = await apiFetch<{ triggers: TriggerSummary[] }>(`/workflows/${workflowId}/triggers`);
  return r.triggers;
}
```

> If your fetch helper isn't named `apiFetch`, replace with the actual name (check existing files in `packages/web/src/api/`).

- [ ] **Step 10.2: FormsInventoryPage**

Create `packages/web/src/routes/forms/FormsInventoryPage.tsx`:

```tsx
import * as React from "react";
import { Link } from "react-router-dom"; // verify actual router
import { listMyForms, type FormListItem } from "../../api/forms.ts";

export function FormsInventoryPage(): JSX.Element {
  const [items, setItems] = React.useState<FormListItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    listMyForms().then(setItems).catch((e) => setError(String(e)));
  }, []);

  if (error) return <div>Error: {error}</div>;
  if (!items) return <div>Loading…</div>;
  if (items.length === 0) return <div>No forms available.</div>;

  return (
    <div className="jm-forms-inventory">
      <h1>Start a workflow</h1>
      <ul>
        {items.map((f) => (
          <li key={f.workflowId}>
            <Link to={`/workflows/${f.workflowId}/form`}>{f.title}</Link>
            <span> — {f.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 10.3: RunFormPage**

Create `packages/web/src/routes/forms/RunFormPage.tsx`:

```tsx
import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getForm, submitForm, type FormSchema, type FormField } from "../../api/forms.ts";

function FieldInput({ field, value, onChange }: { field: FormField; value: unknown; onChange: (v: unknown) => void }): JSX.Element {
  switch (field.widget) {
    case "textarea":
      return <textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return <input type="number" value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
    case "checkbox":
      return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case "select":
      return (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">— select —</option>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case "text":
    default:
      return <input type="text" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function RunFormPage(): JSX.Element {
  const { id: workflowId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [schema, setSchema] = React.useState<FormSchema | null>(null);
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!workflowId) return;
    getForm(workflowId).then(setSchema).catch((e) => setError(String(e)));
  }, [workflowId]);

  if (error) return <div>Error: {error}</div>;
  if (!schema) return <div>Loading…</div>;

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!workflowId) return;
    setSubmitting(true); setError(null);
    try {
      const { workflowInstanceId } = await submitForm(workflowId, values);
      nav(`/workflow-instances/${workflowInstanceId}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="jm-run-form" onSubmit={onSubmit}>
      <h1>{schema.title}</h1>
      {schema.fields.map((f) => (
        <label key={f.name} className="jm-run-form-field">
          <span>{f.label}{f.required ? " *" : ""}</span>
          <FieldInput field={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
          {f.description ? <small>{f.description}</small> : null}
        </label>
      ))}
      <button type="submit" disabled={submitting}>{submitting ? "Submitting…" : "Start"}</button>
    </form>
  );
}
```

- [ ] **Step 10.4: Register routes**

In `packages/web/src/App.tsx`, add two routes alongside the existing workflow routes:

```tsx
import { FormsInventoryPage } from "./routes/forms/FormsInventoryPage.tsx";
import { RunFormPage } from "./routes/forms/RunFormPage.tsx";

// inside the <Routes>:
<Route path="/forms" element={<FormsInventoryPage />} />
<Route path="/workflows/:id/form" element={<RunFormPage />} />
```

(Adapt the route element/component shape to whatever the existing router uses — TanStack Router, React Router v6, etc.)

- [ ] **Step 10.5: Workflow detail trigger summary**

In whichever component renders the workflow detail page header (search `packages/web/src/routes` for the workflow detail page), call `getWorkflowTriggers(workflowId)` on mount and render a small badge row:

```tsx
import { getWorkflowTriggers, type TriggerSummary } from "../../api/workflow-triggers.ts";

const [triggers, setTriggers] = React.useState<TriggerSummary[] | null>(null);
React.useEffect(() => { getWorkflowTriggers(workflowId).then(setTriggers).catch(() => setTriggers([])); }, [workflowId]);

// inside the header JSX:
<div className="jm-trigger-summary">
  Triggered by:{" "}
  {(triggers ?? []).map((t, i) => (
    <span key={t.id}>
      {i > 0 ? ", " : ""}
      {t.type === "trigger-manual" ? "Manual" :
       t.type === "trigger-webhook" ? `Webhook${t.webhook ? ` (${t.webhook.name})` : ""}` :
       "Human form"}
    </span>
  ))}
</div>
```

---

## Task 11: Final typecheck + import-boundary check

- [ ] **Step 11.1: Run typecheck across the workspace**

Run from repo root:

```
npm run typecheck
```

Expected: zero errors. If any error references a type rename done in earlier tasks, locate the file and fix the import — common offenders are anywhere that imported `"start"` as a literal, anywhere reading `start.inputs`, or anywhere referencing the old `SubmitWorkflowInstanceArgs` shape.

- [ ] **Step 11.2: Run import-boundary check**

```
npm run check:boundaries
```

Expected: zero violations. The new `@journeyman/core` types stay inside `core`; the new orchestrator stores depend on `core` only; the new api-server services depend on `core` and `orchestrator` only; the new flow-editor and web components depend on `core` (types) and their own siblings.

- [ ] **Step 11.3: Confirm no unused legacy code remains**

Search for any stray reference to `"start"` as a node type:

```
grep -rn "\"start\"" packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "// legacy"
```

Expected: only matches inside the v1→v2 converter (`migrateV1ToV2` in `conductor-converter.ts`) and any test fixture intentionally using v1 input. Any other hit is a missed migration — open the file and replace with `isTriggerNode` / `findTriggerNodes`.

---

## Self-Review Notes

- Spec coverage check: trigger node types (Task 1), lifted inputs (Task 1), resume-wins precedence (Task 5), trigger index table (Task 2, 4), migration v1→v2 (Task 3), validation rule updates (Task 3), Triggers lane UX (Task 8), per-trigger properties panels (Task 9), Inputs tab (Task 9), human form endpoints (Task 6), triggers summary endpoint (Task 7), web form pages (Task 10), workflow detail trigger summary (Task 10), Run-button rejection if no manual trigger (Task 4 Step 4.6).
- No commit steps (per user instruction).
- No unit-test steps (per user instruction).
- Single typecheck + boundaries pass at end (per user instruction).
- All trigger-node type names are consistent (`trigger-manual` / `trigger-webhook` / `trigger-human`) across types, DB rows (`'manual' | 'webhook' | 'human'`), and config types.
