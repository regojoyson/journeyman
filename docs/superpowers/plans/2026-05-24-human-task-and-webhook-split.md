# Human Task & Webhook Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the existing `human-task` node (which conflates "ask a person" with "wait for a webhook") into two first-class node types: a slimmed `human-task` (person + form + optional notify + timeout) and a new `webhook-wait` (system-event matcher with `listensFor` / `acceptIf` / `fromPath`). Auto-migrate legacy configs on read.

**Architecture:** Both node types share the same Conductor `HUMAN` pause primitive, the same `IHumanTaskResolutionStore`, and the same timeout service. Differences live at the node-type, editor, and webhook-router layer. The webhook ingest endpoint stays one URL per provider — internal routing decides whether an incoming event resumes a `webhook-wait` waiter or falls through to trigger rules.

**Tech Stack:** TypeScript, npm workspaces, Fastify, React (editor), Conductor (orchestrator).

**Constraints from the user:**
- No new unit tests added in this plan (existing tests must still pass — typecheck only at end).
- No commit steps.
- A single `npm run check` at the end to verify types + import boundaries.

**Spec:** [docs/superpowers/specs/2026-05-24-human-task-and-webhook-split-design.md](../specs/2026-05-24-human-task-and-webhook-split-design.md)

---

## File Structure Overview

### New files
- `packages/core/src/types/webhook-wait.types.ts` — `WebhookWaitConfig`, `WebhookWaitOutputField`, `WebhookWaitOutput`.
- `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx` — config UI for the new node.
- `packages/flow-editor/src/canvas/nodes/WebhookWaitNode.tsx` — canvas tile.
- `packages/orchestrator/src/flow-json/migrate-human-task-to-webhook-wait.ts` — pure read-time migrator.
- `packages/api-server/src/services/notify-on-human-task-pause.ts` — best-effort notification dispatch when a `human-task` enters waiting state.

### Modified files
- `packages/core/src/types/flow.types.ts` — add `"webhook-wait"` to `WorkflowNodeType`.
- `packages/core/src/types/human-task.types.ts` — slim `HumanTaskConfig` (drop `listensFor`, `acceptIf`; drop `fromPath` from outputs; add `notify?`). Drop `"webhook"` from `HumanTaskSource`.
- `packages/core/src/index.ts` — export new types.
- `packages/orchestrator/src/flow-json/conductor-converter.ts` — slim `emitHumanTask`, add `emitWebhookWait`, register `"webhook-wait"` in dispatch.
- `packages/orchestrator/src/flow-json/conductor-types.ts` — (no shape change; both nodes still emit a `HUMAN` task — keep the existing `HumanTask` Conductor task interface).
- `packages/orchestrator/src/flow-json/converter-entry.ts` (or wherever flow JSON is read) — invoke the migrator on read.
- `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx` — slim `HumanTaskConfigEditor`, dispatch `webhook-wait` to new editor.
- `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx` — include `webhook-wait` in the control-node branch.
- `packages/flow-editor/src/canvas/node-registry.ts` — register `WebhookWaitNode`.
- `packages/flow-editor/src/palette/built-in-categories.ts` — add Webhook Wait palette entry; refresh Human Task description.
- `packages/api-server/src/services/match-human-tasks.ts` — generalize: only match `webhook-wait` nodes; ignore `human-task`.
- `packages/api-server/src/services/resolve-human-task.ts` — accept resolution for both node types but constrain `source`: `human-task` allows `"manual" | "timeout"`; `webhook-wait` allows `"webhook" | "timeout"`.
- `packages/api-server/src/composition.ts` — wire the notify-on-pause service.
- `packages/api-server/src/index.ts` (server bootstrap) — start the notify-on-pause subscription.

---

## Task 1: Add `webhook-wait` to `WorkflowNodeType`

**Files:**
- Modify: `packages/core/src/types/flow.types.ts:12-26`

- [ ] **Step 1: Add the union member**

Edit `packages/core/src/types/flow.types.ts`. In the `WorkflowNodeType` union, add `"webhook-wait"` right after `"human-task"`:

```ts
export type WorkflowNodeType =
  | "start"
  | "end"
  | "step"
  | "human-task"
  | "webhook-wait"
  // node types reserved for later step types — listed so the converter can reject
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

---

## Task 2: Create `WebhookWaitConfig` types

**Files:**
- Create: `packages/core/src/types/webhook-wait.types.ts`

- [ ] **Step 1: Write the new types module**

Create `packages/core/src/types/webhook-wait.types.ts`:

```ts
import type { JsonLogicExpr } from "./flow-condition.types.ts";
import type { WebhookProvider } from "./webhook.types.ts";

export interface WebhookWaitOutputField {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "date";
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  /** Dot-path into the webhook payload to extract this field's value. */
  fromPath?: string;
}

export interface WebhookWaitConfig {
  /** Which provider's events this node listens to. */
  provider: WebhookProvider;
  /** Event-type allowlist; empty/undefined means accept any event type. */
  listensFor?: string[];
  /** JSONLogic predicate evaluated against the raw payload; must be truthy to match. */
  acceptIf?: JsonLogicExpr;
  /**
   * How this paused node binds to an incoming event. V1 only supports
   * `"issueRef"` — the matcher uses the workflow instance's `issueRef` and
   * compares against the event's extracted ref.
   */
  correlationKey?: "issueRef";
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

- [ ] **Step 2: Re-export from `packages/core/src/index.ts`**

Open `packages/core/src/index.ts` and add (next to existing human-task export):

```ts
export type {
  WebhookWaitConfig,
  WebhookWaitOutputField,
  WebhookWaitOutput,
  WebhookWaitReservedKey,
  WebhookWaitSource,
} from "./types/webhook-wait.types.ts";
export { WEBHOOK_WAIT_RESERVED_KEYS } from "./types/webhook-wait.types.ts";
```

(If `webhook.types.ts` is not already exported with `WebhookProvider`, also ensure that export exists in `index.ts`.)

---

## Task 3: Slim `HumanTaskConfig`

**Files:**
- Modify: `packages/core/src/types/human-task.types.ts`

- [ ] **Step 1: Replace the file contents**

Replace `packages/core/src/types/human-task.types.ts` with:

```ts
/**
 * A field the human-task asks the person to fill in. Each declared output
 * becomes a top-level artifact on the node (e.g. `humanTask1.<name>`).
 *
 * The `name` must be unique per node and not collide with the reserved meta
 * keys: "source", "actor", "resolvedAt", "payload".
 */
export interface HumanTaskOutputField {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "date";
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
}

/** Where/how to notify a human when the task pauses. */
export interface HumanTaskNotifyConfig {
  /** Notification provider channel — currently "slack" or "console". */
  channel: "slack" | "console";
  /** Free-form target — Slack user id, channel, or email depending on channel. */
  target: string;
  /** Optional override of the message body. The resolve-page link is always appended. */
  message?: string;
}

export interface HumanTaskConfig {
  /** Question/instructions shown to the human. */
  prompt?: string;

  /** Form fields the human fills in. Empty array is allowed (no structured outputs). */
  outputs: HumanTaskOutputField[];

  /** Optional notification dispatched when the task pauses. Best-effort delivery. */
  notify?: HumanTaskNotifyConfig;

  /** Optional auto-resolve. Off by default. */
  timeout?: {
    duration: string;
    /** Values to fill into declared outputs when the timeout fires. */
    defaults?: Record<string, unknown>;
  };
}

export type HumanTaskSource = "manual" | "timeout";

/**
 * Reserved meta keys that always appear on the resolved node output. Output
 * field names declared in `HumanTaskConfig.outputs` must not collide with
 * any of these.
 */
export const HUMAN_TASK_RESERVED_KEYS = ["source", "actor", "resolvedAt", "payload"] as const;
export type HumanTaskReservedKey = typeof HUMAN_TASK_RESERVED_KEYS[number];

export type HumanTaskOutput = {
  source: HumanTaskSource;
  actor: string | null;
  resolvedAt: string;
  /** `{ ...form values }` for manual; `{}` for timeout. */
  payload: Record<string, unknown>;
} & Record<string, unknown>;
```

Notes:
- `listensFor`, `acceptIf`, `fromPath` are removed from this file. They now live exclusively on `WebhookWaitConfig`.
- `HumanTaskSource` no longer includes `"webhook"`. The resolution store's column still accepts `"webhook"` strings (no DB change needed), but no human-task code path will write that source anymore.

- [ ] **Step 2: Re-export `HumanTaskNotifyConfig`**

In `packages/core/src/index.ts`, ensure `HumanTaskNotifyConfig` is included alongside the other `HumanTask*` re-exports.

---

## Task 4: Update Conductor converter — slim `emitHumanTask`, add `emitWebhookWait`

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`

- [ ] **Step 1: Slim `emitHumanTask` (lines ~307-350)**

Replace the body of `emitHumanTask` so that `inputParameters` no longer references `listensFor` or `acceptIf`:

```ts
emitHumanTask(node: WorkflowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
  const cfg = (node.config ?? {}) as Partial<import("@journeyman/core").HumanTaskConfig>;

  const outputs = Array.isArray(cfg.outputs) ? cfg.outputs : [];
  this.validateOutputNames(node, outputs, ["source", "actor", "resolvedAt", "payload"], "Human-task");

  const human: import("./conductor-types.ts").HumanTask = {
    type: "HUMAN",
    name: `human_${node.id}`,
    taskReferenceName: node.id,
    inputParameters: {
      outputs,
      ...(cfg.prompt !== undefined ? { prompt: cfg.prompt } : {}),
      ...(cfg.notify ? { notify: cfg.notify } : {}),
      ...(cfg.timeout ? {
        timeoutDurationMs: parseDurationMs(cfg.timeout.duration),
        ...(cfg.timeout.defaults ? { timeoutDefaults: cfg.timeout.defaults } : {}),
      } : {}),
      kind: "human-task",
    },
  };

  return { tasks: [human], nextNodeId: this.successor(node.id) };
}
```

- [ ] **Step 2: Extract the output-name validation into a private helper on the converter class**

Add to the converter class (above `emitHumanTask`):

```ts
private validateOutputNames(
  node: WorkflowNode,
  outputs: ReadonlyArray<{ name: string }>,
  reserved: readonly string[],
  label: string,
): void {
  const reservedSet = new Set(reserved);
  const seen = new Set<string>();
  for (const o of outputs) {
    if (!o.name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(o.name)) {
      throw new WorkflowValidationError(
        `${label} ${this.label(node)} output name '${o.name}' is invalid (must be alphanumeric / underscore, not start with digit)`,
      );
    }
    if (reservedSet.has(o.name)) {
      throw new WorkflowValidationError(
        `${label} ${this.label(node)} output name '${o.name}' collides with a reserved meta key`,
      );
    }
    if (seen.has(o.name)) {
      throw new WorkflowValidationError(`${label} ${this.label(node)} has duplicate output name '${o.name}'`);
    }
    seen.add(o.name);
  }
}
```

- [ ] **Step 3: Add `emitWebhookWait`**

Add a new method on the converter class (immediately after `emitHumanTask`):

```ts
emitWebhookWait(node: WorkflowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
  const cfg = (node.config ?? {}) as Partial<import("@journeyman/core").WebhookWaitConfig>;

  if (!cfg.provider) {
    throw new WorkflowValidationError(`Webhook-wait ${this.label(node)} must declare a provider`);
  }

  const outputs = Array.isArray(cfg.outputs) ? cfg.outputs : [];
  this.validateOutputNames(node, outputs, ["source", "resolvedAt", "webhookEventId", "payload"], "Webhook-wait");

  const human: import("./conductor-types.ts").HumanTask = {
    type: "HUMAN",
    name: `webhookwait_${node.id}`,
    taskReferenceName: node.id,
    inputParameters: {
      outputs,
      provider: cfg.provider,
      correlationKey: cfg.correlationKey ?? "issueRef",
      ...(cfg.listensFor ? { listensFor: cfg.listensFor } : {}),
      ...(cfg.acceptIf ? { acceptIf: cfg.acceptIf } : {}),
      ...(cfg.timeout ? {
        timeoutDurationMs: parseDurationMs(cfg.timeout.duration),
        ...(cfg.timeout.defaults ? { timeoutDefaults: cfg.timeout.defaults } : {}),
      } : {}),
      kind: "webhook-wait",
    },
  };

  return { tasks: [human], nextNodeId: this.successor(node.id) };
}
```

- [ ] **Step 4: Wire dispatch (line ~200)**

In the converter's main `switch (node.type)`, add the new case directly after `human-task`:

```ts
case "human-task":    return this.emitHumanTask(node);
case "webhook-wait":  return this.emitWebhookWait(node);
```

---

## Task 5: Read-time migrator (legacy `human-task` → `webhook-wait`)

**Files:**
- Create: `packages/orchestrator/src/flow-json/migrate-human-task-to-webhook-wait.ts`

- [ ] **Step 1: Write the migrator**

Create `packages/orchestrator/src/flow-json/migrate-human-task-to-webhook-wait.ts`:

```ts
import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";

/**
 * Read-time migration: any node with type "human-task" that carries the
 * legacy webhook-matching fields (listensFor, acceptIf, or outputs with
 * fromPath) is converted in-memory to a "webhook-wait" node.
 *
 * Provider is inferred from the first listensFor entry's prefix when present
 * (e.g. "jira:issue_updated" → "jira"); otherwise defaults to "api".
 *
 * Pure: returns a new graph; does not mutate input. The stored definition
 * on disk is unchanged — callers do this on every read.
 */
export function migrateHumanTaskToWebhookWait(graph: WorkflowGraph): WorkflowGraph {
  let changed = false;
  const nodes: WorkflowNode[] = graph.nodes.map((node) => {
    if (node.type !== "human-task") return node;

    const cfg = (node.config ?? {}) as Record<string, unknown>;
    const outputs = Array.isArray(cfg.outputs) ? cfg.outputs as Array<Record<string, unknown>> : [];
    const hasListensFor = Array.isArray(cfg.listensFor) && (cfg.listensFor as unknown[]).length > 0;
    const hasAcceptIf = cfg.acceptIf != null;
    const hasFromPath = outputs.some(o => typeof o.fromPath === "string" && (o.fromPath as string).length > 0);

    if (!hasListensFor && !hasAcceptIf && !hasFromPath) return node;

    const provider = inferProvider(cfg.listensFor as string[] | undefined);

    const nextConfig: Record<string, unknown> = {
      provider,
      correlationKey: "issueRef",
      outputs,
    };
    if (hasListensFor) nextConfig.listensFor = cfg.listensFor;
    if (hasAcceptIf) nextConfig.acceptIf = cfg.acceptIf;
    if (cfg.timeout) nextConfig.timeout = cfg.timeout;

    changed = true;
    return { ...node, type: "webhook-wait", config: nextConfig };
  });

  return changed ? { ...graph, nodes } : graph;
}

function inferProvider(listensFor: string[] | undefined): string {
  if (!listensFor || listensFor.length === 0) return "api";
  const first = listensFor[0];
  if (first.startsWith("jira:")) return "jira";
  if (first.startsWith("linear:") || ["create", "update", "remove"].includes(first)) return "linear";
  if (first.startsWith("monday:")) return "monday";
  // GitHub event types (pull_request, issues, issue_comment, …) are unprefixed.
  if (["pull_request", "pull_request_review", "issues", "issue_comment"].includes(first)) return "github";
  return "api";
}
```

- [ ] **Step 2: Invoke the migrator at flow-read time**

Find the central flow JSON read path. The most likely location is the converter's public entry (where `WorkflowGraph` enters before `emitHumanTask` etc.). Open `packages/orchestrator/src/flow-json/conductor-converter.ts` and locate the converter's constructor or `convert(graph: WorkflowGraph)` entry point. Apply the migrator before any per-node dispatch:

```ts
import { migrateHumanTaskToWebhookWait } from "./migrate-human-task-to-webhook-wait.ts";
// …
constructor(graph: WorkflowGraph /* or wherever the entry is */) {
  this.graph = migrateHumanTaskToWebhookWait(graph);
  // existing setup using this.graph …
}
```

If the converter receives the graph in a method instead, apply the migrator at the very top of that method. The migration is pure and idempotent — safe to call on every entry.

- [ ] **Step 3: Apply the same migrator at the API server's flow read path**

Open `packages/api-server/src/routes/flows.ts`. Find every place a flow definition is loaded from the DB and returned to the client (typically a `GET /flows/:id` handler that resolves a row to a `WorkflowGraph`). Import the migrator from `@journeyman/orchestrator` (re-export from `packages/orchestrator/src/index.ts` if not already exposed) and run it on the loaded graph before returning to the client. This ensures the editor sees converted nodes.

If exporting from orchestrator's `index.ts` is needed, add:

```ts
export { migrateHumanTaskToWebhookWait } from "./flow-json/migrate-human-task-to-webhook-wait.ts";
```

---

## Task 6: Split editor — slim `HumanTaskConfigEditor`, add `WebhookWaitConfigEditor`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx`
- Create: `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx`
- Modify: `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`

- [ ] **Step 1: Dispatch new node type in `ControlNodeConfigTab.tsx`**

Open `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx`. Just below the existing `human-task` dispatch (around line 133), add:

```tsx
if (node.type === "human-task") {
  return <HumanTaskConfigEditor node={node} onChange={onChange} readOnly={readOnly} />;
}

if (node.type === "webhook-wait") {
  return <WebhookWaitConfigEditor node={node} onChange={onChange} readOnly={readOnly} />;
}
```

Add the import at the top of the file:

```tsx
import { WebhookWaitConfigEditor } from "./WebhookWaitConfigEditor.tsx";
```

- [ ] **Step 2: Slim `HumanTaskConfigEditor`**

Within the same file, replace the `HumanTaskOutputCfg` local interface and the `HumanTaskConfigEditor` component so that:

1. `HumanTaskOutputCfg` no longer has `fromPath`.
2. The `cfg` shape no longer references `listensFor` or `acceptIf`.
3. The "Listens for" `<div className="je-field">` block (lines ~288-317) is removed entirely.
4. The "Accept if" `<div className="je-field">` block (lines ~319-338) is removed entirely.
5. The output-row "Payload source" `<input>` (lines ~261-269) is removed.
6. The "Outputs" hint copy (line ~210) is updated to drop the "or an incoming webhook" parenthetical.
7. A new optional "Notify" `<div className="je-field">` block is added before the "Timeout" block.

Replace the local `HumanTaskOutputCfg`:

```tsx
interface HumanTaskOutputCfg {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "date";
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
}
```

Replace the `cfg` cast inside the editor body:

```tsx
const cfg = (node.config ?? {}) as {
  prompt?: string;
  outputs?: HumanTaskOutputCfg[];
  notify?: { channel: "slack" | "console"; target: string; message?: string };
  timeout?: { duration: string; defaults?: Record<string, unknown> };
};
```

Update the Outputs hint:

```tsx
<p className="je-hint">
  Form fields the human fills in to resolve this task. Each row is one value that later steps in this workflow can use.
</p>
```

Remove the `<input>` with `placeholder="e.g. issue.fields.status.name"` (the `fromPath` input) and its surrounding spacing.

Remove the entire `Listens for` and `Accept if` `<div className="je-field">` blocks.

Add the Notify block immediately before the Timeout block:

```tsx
<div className="je-field">
  <label className="je-field__label">Notify (optional)</label>
  <div style={{ display: "flex", gap: 8 }}>
    <select
      value={cfg.notify?.channel ?? ""}
      disabled={readOnly}
      onChange={e => {
        const channel = e.target.value as "slack" | "console" | "";
        if (!channel) return update({ notify: undefined });
        update({ notify: { channel, target: cfg.notify?.target ?? "", message: cfg.notify?.message } });
      }}
    >
      <option value="">— none —</option>
      <option value="slack">Slack DM</option>
      <option value="console">Console (debug)</option>
    </select>
    {cfg.notify && (
      <input
        type="text"
        value={cfg.notify.target}
        disabled={readOnly}
        placeholder={cfg.notify.channel === "slack" ? "@user or #channel" : "any identifier"}
        onChange={e => update({ notify: { ...cfg.notify!, target: e.target.value } })}
        style={{ flex: 1 }}
      />
    )}
  </div>
  {cfg.notify && (
    <textarea
      rows={2}
      value={cfg.notify.message ?? ""}
      disabled={readOnly}
      placeholder="Optional message body. A link to the resolve page is always appended."
      onChange={e => update({ notify: { ...cfg.notify!, message: e.target.value || undefined } })}
      style={{ marginTop: 6, width: "100%" }}
    />
  )}
  <p className="je-hint">When the task pauses, a notification is sent. Delivery failure does not fail the run.</p>
</div>
```

- [ ] **Step 3: Create `WebhookWaitConfigEditor.tsx`**

Create `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx`:

```tsx
import { useState } from "react";
import type { WorkflowNode } from "@journeyman/core";
import { AcceptIfBuilder } from "./AcceptIfBuilder.tsx";

interface WebhookWaitOutputCfg {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "date";
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  fromPath?: string;
}

interface WebhookWaitEditorProps {
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

const PROVIDERS = ["jira", "github", "gitlab", "monday", "linear", "api"] as const;

export function WebhookWaitConfigEditor({ node, onChange, readOnly }: WebhookWaitEditorProps) {
  const cfg = (node.config ?? {}) as {
    provider?: string;
    listensFor?: string[];
    acceptIf?: unknown;
    correlationKey?: "issueRef";
    outputs?: WebhookWaitOutputCfg[];
    timeout?: { duration: string; defaults?: Record<string, unknown> };
  };
  const outputs = cfg.outputs ?? [];

  const [defaultsDraft, setDefaultsDraft] = useState<string>(
    cfg.timeout?.defaults ? JSON.stringify(cfg.timeout.defaults, null, 2) : "",
  );
  const [defaultsError, setDefaultsError] = useState<string | null>(null);

  const update = (patch: Partial<typeof cfg>) => {
    onChange({ ...node, config: { ...cfg, ...patch } });
  };

  const updateOutput = (idx: number, patch: Partial<WebhookWaitOutputCfg>) => {
    const next = outputs.slice();
    next[idx] = { ...next[idx], ...patch };
    update({ outputs: next });
  };

  const removeOutput = (idx: number) => {
    update({ outputs: outputs.filter((_, i) => i !== idx) });
  };

  const addOutput = () => {
    let n = outputs.length + 1;
    let name = `field${n}`;
    while (outputs.some(o => o.name === name)) name = `field${++n}`;
    update({ outputs: [...outputs, { name, type: "string" }] });
  };

  return (
    <div className="je-tab je-tab--config je-humantask">
      <div className="je-field">
        <label className="je-field__label">Provider</label>
        <select
          value={cfg.provider ?? ""}
          disabled={readOnly}
          onChange={e => update({ provider: e.target.value })}
        >
          <option value="">— pick a provider —</option>
          {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <p className="je-hint">Which provider's events resolve this node. Each provider has one webhook URL configured globally.</p>
      </div>

      <div className="je-field">
        <label className="je-field__label">Listens for</label>
        <input
          type="text"
          placeholder="e.g. jira:issue_updated, pull_request_review"
          value={(cfg.listensFor ?? []).join(", ")}
          disabled={readOnly}
          onChange={e => update({
            listensFor: e.target.value.split(",").map(s => s.trim()).filter(Boolean),
          })}
        />
        <p className="je-hint">Comma-separated event types. Empty means any event type from the provider.</p>
      </div>

      <div className="je-field">
        <label className="je-field__label">Accept if (optional)</label>
        <AcceptIfBuilder
          value={cfg.acceptIf}
          knownPaths={Array.from(new Set(
            outputs.map(o => o.fromPath?.trim()).filter((p): p is string => !!p)
          ))}
          readOnly={readOnly}
          datalistId={`acceptif-paths-${node.id}`}
          onChange={next => update({ acceptIf: next })}
        />
        <p className="je-hint">Filter incoming webhooks by payload values.</p>
      </div>

      <div className="je-field">
        <label className="je-field__label">Correlation</label>
        <select
          value={cfg.correlationKey ?? "issueRef"}
          disabled={readOnly}
          onChange={e => update({ correlationKey: e.target.value as "issueRef" })}
        >
          <option value="issueRef">By issue reference</option>
        </select>
        <p className="je-hint">How this paused node binds to an incoming event. V1 supports issue-ref correlation only.</p>
      </div>

      <div className="je-field">
        <label className="je-field__label">Outputs</label>
        <p className="je-hint">Values extracted from the incoming payload to pass to later steps.</p>
        <div className="je-humantask__outputs">
          {outputs.length === 0 && (
            <div className="je-humantask__empty">No outputs declared. Meta keys (source, resolvedAt, payload) are still emitted.</div>
          )}
          {outputs.map((o, i) => (
            <div key={i} className="je-humantask__output-row">
              <input
                type="text"
                value={o.name}
                disabled={readOnly}
                placeholder="name"
                onChange={e => updateOutput(i, { name: e.target.value })}
                style={{ flex: 1 }}
              />
              <select
                value={o.type}
                disabled={readOnly}
                onChange={e => updateOutput(i, { type: e.target.value as WebhookWaitOutputCfg["type"] })}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="date">date</option>
                <option value="json">json</option>
              </select>
              <input
                type="text"
                value={o.fromPath ?? ""}
                disabled={readOnly}
                placeholder="e.g. issue.fields.status.name"
                onChange={e => updateOutput(i, { fromPath: e.target.value || undefined })}
                style={{ flex: 2 }}
              />
              {!readOnly && (
                <button type="button" className="je-humantask__chip-x" aria-label="Remove output" onClick={() => removeOutput(i)}>×</button>
              )}
            </div>
          ))}
        </div>
        {!readOnly && (
          <button type="button" className="je-humantask__btn" onClick={addOutput} style={{ marginTop: 6 }}>
            + Add output
          </button>
        )}
      </div>

      <div className="je-field">
        <label className="je-field__label">Timeout (optional)</label>
        <input
          type="text"
          placeholder="48h"
          value={cfg.timeout?.duration ?? ""}
          disabled={readOnly}
          onChange={e => {
            const duration = e.target.value;
            if (!duration) return update({ timeout: undefined });
            update({ timeout: { duration, defaults: cfg.timeout?.defaults } });
          }}
        />
        {cfg.timeout?.duration && (
          <>
            <textarea
              rows={3}
              placeholder='{"approved": false}'
              value={defaultsDraft}
              disabled={readOnly}
              onChange={e => {
                setDefaultsDraft(e.target.value);
                if (!e.target.value.trim()) {
                  setDefaultsError(null);
                  update({ timeout: { duration: cfg.timeout!.duration, defaults: undefined } });
                  return;
                }
                try {
                  const parsed = JSON.parse(e.target.value);
                  setDefaultsError(null);
                  update({ timeout: { duration: cfg.timeout!.duration, defaults: parsed } });
                } catch {
                  setDefaultsError("Invalid JSON");
                }
              }}
              style={{ marginTop: 6, width: "100%", fontFamily: "monospace" }}
            />
            {defaultsError && <div className="je-error">{defaultsError}</div>}
          </>
        )}
        <p className="je-hint">When the timeout fires, declared outputs are filled from the JSON above and the workflow resumes.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update `PropertiesPanel.tsx`**

Open `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`. Find the line (around 127):

```tsx
) : node.type === "loop" || node.type === "timer" || node.type === "human-task" ? (
```

Add `webhook-wait` to the list:

```tsx
) : node.type === "loop" || node.type === "timer" || node.type === "human-task" || node.type === "webhook-wait" ? (
```

---

## Task 7: Canvas tile for `webhook-wait`

**Files:**
- Create: `packages/flow-editor/src/canvas/nodes/WebhookWaitNode.tsx`
- Modify: `packages/flow-editor/src/canvas/node-registry.ts`

- [ ] **Step 1: Read existing `HumanTaskNode.tsx` to mirror its structure**

Open `packages/flow-editor/src/canvas/nodes/HumanTaskNode.tsx` to confirm the prop and rendering pattern.

- [ ] **Step 2: Create `WebhookWaitNode.tsx`**

Create `packages/flow-editor/src/canvas/nodes/WebhookWaitNode.tsx` mirroring `HumanTaskNode.tsx` but with the label "Webhook Wait" and an icon (use `🔔`):

```tsx
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";

export interface WebhookWaitNodeData {
  label?: string;
  provider?: string;
}

export function WebhookWaitNode(props: NodeProps) {
  const data = props.data as WebhookWaitNodeData;
  return (
    <div className="je-node je-node--human-task">
      <Handle type="target" position={Position.Top} />
      <div className="je-node__icon">🔔</div>
      <div className="je-node__label">{data.label ?? "Webhook Wait"}</div>
      {data.provider && <div className="je-node__subtitle">{data.provider}</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

If `HumanTaskNode.tsx` uses different exact class names or structure, match them — the structure above is a template, adapt to actual styles seen in the existing file.

- [ ] **Step 3: Register the node in `node-registry.ts`**

Open `packages/flow-editor/src/canvas/node-registry.ts`. Below the existing `HumanTaskNode` import:

```ts
import { HumanTaskNode } from "./nodes/HumanTaskNode.tsx";
import { WebhookWaitNode } from "./nodes/WebhookWaitNode.tsx";
```

And in the registry map (where `"human-task": HumanTaskNode` lives):

```ts
"human-task": HumanTaskNode,
"webhook-wait": WebhookWaitNode,
```

---

## Task 8: Palette entries

**Files:**
- Modify: `packages/flow-editor/src/palette/built-in-categories.ts`

- [ ] **Step 1: Refresh Human Task description and add Webhook Wait entry**

Open `packages/flow-editor/src/palette/built-in-categories.ts` and find the existing `human-task` entry (line 11). Replace it and add a new line for `webhook-wait`:

```ts
{ nodeType: "human-task",    label: "Human Task",    category: "Logic",   color: "#fbc531", icon: "⏳", description: "Pause for a person to fill a form; optionally notify them" },
{ nodeType: "webhook-wait",  label: "Webhook Wait",  category: "Logic",   color: "#00a8ff", icon: "🔔", description: "Pause until a matching provider webhook arrives" },
```

---

## Task 9: Generalize webhook-router matcher

**Files:**
- Modify: `packages/api-server/src/services/match-human-tasks.ts`
- Modify: `packages/api-server/src/routes/webhooks.ts`

- [ ] **Step 1: Rename the matcher and gate by node type**

Open `packages/api-server/src/services/match-human-tasks.ts`. Rename the exported function and tighten the node-type check. The intent: only resolve `webhook-wait` nodes from this code path; never resolve `human-task` nodes via webhooks.

Replace the file's exported function header and the central type check. Around line 35:

```ts
// Replace the existing line:
// if (!node || node.type !== "human-task") continue;
// with:
if (!node || node.type !== "webhook-wait") continue;

const cfg = (node.config ?? {}) as unknown as import("@journeyman/core").WebhookWaitConfig;
```

Replace usages of `HumanTaskConfig` / `HumanTaskOutputField` in this file with `WebhookWaitConfig` / `WebhookWaitOutputField` imported from `@journeyman/core`.

Also rename the exported function from `matchAndResolveHumanTasks` to `matchAndResolveWebhookWaits` (keep the file name for diff-friendliness or rename the file — file rename optional; the export name change is required):

```ts
export async function matchAndResolveWebhookWaits(c: Composition, ev: WebhookEventInfo): Promise<MatchResult> {
  // …existing body, with the node.type check tightened to "webhook-wait"…
}
```

Keep the call to `resolveHumanTask` (the underlying store + Conductor signal logic is the same; only the node-type gate moved). The `source: "webhook"` value passed in is correct.

- [ ] **Step 2: Update import + call site in `webhooks.ts`**

Open `packages/api-server/src/routes/webhooks.ts`. Update the import on line 4 and the call on line 81:

```ts
import { matchAndResolveWebhookWaits } from "../services/match-human-tasks.ts";
// …
const resolveResult = await matchAndResolveWebhookWaits(c, {
  id: event.id,
  provider,
  eventType,
  issueRef,
  rawPayload,
});
```

---

## Task 10: Constrain `resolveHumanTask` by node type

**Files:**
- Modify: `packages/api-server/src/services/resolve-human-task.ts`

- [ ] **Step 1: Accept both node types but constrain `source` per node type**

Open `packages/api-server/src/services/resolve-human-task.ts`. Find the existing check (~line 40):

```ts
if (!node || node.type !== "human-task") {
  throw new Error(`node ${input.nodeId} on workflowInstance ${input.workflowInstanceId} is not a human-task`);
}
```

Replace with:

```ts
if (!node || (node.type !== "human-task" && node.type !== "webhook-wait")) {
  throw new Error(`node ${input.nodeId} on workflowInstance ${input.workflowInstanceId} is not resolvable (type=${node?.type ?? "missing"})`);
}

if (node.type === "human-task" && input.source === "webhook") {
  throw new Error(`human-task ${input.nodeId} cannot be resolved by webhook`);
}
if (node.type === "webhook-wait" && input.source === "manual") {
  throw new Error(`webhook-wait ${input.nodeId} cannot be resolved manually`);
}
```

Update the `HumanTaskConfig` cast immediately below so it picks the right config shape per node type:

```ts
const cfg = (node.config ?? {}) as unknown as { outputs?: Array<{ name: string; type: string; required?: boolean; default?: unknown }> };
const outputs = Array.isArray(cfg.outputs) ? cfg.outputs : [];
```

(Both `HumanTaskConfig.outputs` and `WebhookWaitConfig.outputs` share the same `name`/`type`/`required`/`default` shape — the local narrow type above covers both.)

---

## Task 11: Notification on human-task pause

**Files:**
- Create: `packages/api-server/src/services/notify-on-human-task-pause.ts`
- Modify: `packages/api-server/src/composition.ts`
- Modify: `packages/api-server/src/index.ts` (server bootstrap)

- [ ] **Step 1: Inspect the engine emission API**

Before writing the dispatcher, open `packages/core/src/interfaces/event-bus.interface.ts` and `packages/orchestrator/src/index.ts` to confirm the event-bus emission shape used when a node enters waiting. Look for `node.waiting`, `node.entered`, or similar engine emissions referenced by `engine-node-resolved-emissions-design.md`.

If the engine does not currently emit a "node entered waiting" event, this task degrades to "stub the dispatcher and wire it where reconcileWorkflowInstance detects a new waiter" — note this as Option B below.

- [ ] **Step 2: Write the dispatcher**

Create `packages/api-server/src/services/notify-on-human-task-pause.ts`:

```ts
import type { Composition } from "../composition.ts";
import type { HumanTaskNotifyConfig } from "@journeyman/core";

/**
 * Best-effort notification when a `human-task` node enters waiting.
 * Failures are logged and swallowed — they must not fail the workflow.
 */
export async function notifyOnHumanTaskPause(
  c: Composition,
  args: {
    workflowInstanceId: string;
    nodeId: string;
    notify: HumanTaskNotifyConfig;
    prompt?: string;
  },
): Promise<void> {
  try {
    const link = buildResolveLink(c, args.workflowInstanceId, args.nodeId);
    const body = [args.notify.message ?? args.prompt ?? "You have a task waiting.", link].filter(Boolean).join("\n\n");

    if (args.notify.channel === "console") {
      // Console channel is a debug sink — log via the composition logger.
      c.logger.info(`[human-task notify] ${args.notify.target}: ${body}`);
      return;
    }

    if (args.notify.channel === "slack") {
      if (!c.notifications) {
        c.logger.warn("[human-task notify] notifications provider unavailable; skipping");
        return;
      }
      await c.notifications.sendMessage({
        channel: "slack",
        target: args.notify.target,
        body,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    c.logger.warn(`[human-task notify] delivery failed: ${msg}`);
  }
}

function buildResolveLink(c: Composition, workflowInstanceId: string, nodeId: string): string {
  const base = c.publicBaseUrl ?? "";
  return `${base}/workflow-instances/${workflowInstanceId}#node-${nodeId}`;
}
```

Note: `c.logger`, `c.notifications`, and `c.publicBaseUrl` must exist on the `Composition`. Check `packages/api-server/src/composition.ts`. If `publicBaseUrl` is not on Composition, add it as an optional string field plumbed from env at bootstrap (`process.env.PUBLIC_BASE_URL ?? ""`). If `notifications` (`INotificationProvider`) is not on Composition, add it as an optional field; leave undefined when not configured, which the dispatcher already handles.

If `INotificationProvider.sendMessage` signature differs from `{ channel, target, body }`, adapt the call to match the actual interface in `packages/core/src/interfaces/notification.interface.ts`.

- [ ] **Step 3: Wire the dispatcher to engine emissions**

Find where node-entered-waiting transitions are observed in the api-server (likely `engine-reconciler.ts` referenced by `match-human-tasks.ts`). At the point where the reconciler detects a node moving into `waiting` for the first time, after persisting the state change call:

```ts
if (node.type === "human-task") {
  const cfg = (node.config ?? {}) as { notify?: HumanTaskNotifyConfig; prompt?: string };
  if (cfg.notify) {
    await notifyOnHumanTaskPause(c, {
      workflowInstanceId: instance.id,
      nodeId: node.id,
      notify: cfg.notify,
      prompt: cfg.prompt,
    });
  }
}
```

Wrap this in a `try/catch` if the surrounding loop already swallows errors; otherwise the dispatcher's own try/catch is sufficient.

If the engine has a dedicated event bus (`c.events`), the cleaner wiring is to subscribe at bootstrap. In `packages/api-server/src/index.ts`, after composition is built:

```ts
c.events?.on("node.waiting", async (evt) => {
  const inst = await c.workflowInstances.getById(evt.workflowInstanceId);
  if (!inst) return;
  const node = inst.definitionSnapshot.nodes.find(n => n.id === evt.nodeId);
  if (!node || node.type !== "human-task") return;
  const cfg = (node.config ?? {}) as { notify?: HumanTaskNotifyConfig; prompt?: string };
  if (!cfg.notify) return;
  await notifyOnHumanTaskPause(c, {
    workflowInstanceId: inst.id,
    nodeId: node.id,
    notify: cfg.notify,
    prompt: cfg.prompt,
  });
});
```

Pick whichever surface the codebase already uses for "engine state change observed" — do not invent a new one.

---

## Task 12: Catalog / validators / converter dispatch coverage

**Files:**
- Audit: `packages/steps/src/catalog-validators.ts`, `packages/steps/src/catalog.ts`
- Audit: `packages/orchestrator/src/flow-json/conductor-converter.ts` (full file)

- [ ] **Step 1: Grep for `"human-task"` string literals**

Run:

```bash
grep -rEn '"human-task"' packages --include='*.ts' --include='*.tsx'
```

Expected: hits in editor (covered above), converter dispatch (covered in Task 4), reconciler / matcher (covered in Task 9), `palette/built-in-categories.ts` (Task 8), and possibly a validator or catalog file.

For every hit not covered by an earlier task, decide whether the new `"webhook-wait"` type should also be handled there. The two most likely places:

- Any list of "control-type nodes" (nodes that aren't `step`).
- Any validator that switches on `node.type`.

Add `"webhook-wait"` parallel handling where missing.

- [ ] **Step 2: Confirm the converter dispatch is exhaustive**

In `packages/orchestrator/src/flow-json/conductor-converter.ts`, scan the main `switch (node.type)` block. Confirm the `webhook-wait` case was added (Task 4 Step 4). If there's a `default:` branch that throws "not yet supported" for unhandled node types, ensure `webhook-wait` is matched before it.

---

## Task 13: Final typecheck

**Files:** none

- [ ] **Step 1: Run repo-wide typecheck + import boundary check**

Run from the repo root:

```bash
npm run check
```

Expected: clean exit (0). The script runs `npm run typecheck` and `npm run check:boundaries` per `CLAUDE.md`.

- [ ] **Step 2: If errors surface, fix them in place**

Common likely failures and where they live:
- **"Property 'listensFor' does not exist on type 'HumanTaskConfig'"** — a forgotten reference. Move the reading code to use `WebhookWaitConfig` (if it's in the matcher path) or delete it (if it's in human-task code).
- **"Type '\"webhook\"' is not assignable to type 'HumanTaskSource'"** — a code path passing `source: "webhook"` to `resolveHumanTask` for a `human-task` node. Should already be impossible after Task 10; if it surfaces, the path is wrong.
- **"Property 'notify' does not exist"** — ensure `HumanTaskNotifyConfig` is exported from `@journeyman/core/index.ts` (Task 3 Step 2).
- **"Cannot find module './migrate-human-task-to-webhook-wait.ts'"** — Task 5 file path or import path mismatch.

Re-run `npm run check` until it exits clean.

---

## Self-Review Notes

Spec coverage check:
- Human Task slim config (Question/Fields/Notify/Timeout) — Tasks 3 + 6.
- Webhook Wait config (Provider/ListensFor/AcceptIf/Correlation/Outputs/Timeout) — Tasks 2 + 6.
- Migration of legacy nodes — Task 5.
- One webhook URL per provider, internal routing unchanged — Tasks 9 (matcher rename), router stays put.
- Notification on human-task pause — Task 11.
- Conductor pause primitive shared — Task 4 (both emit `HUMAN`).
- Output artifact shapes — Types in Tasks 2 + 3; emission is implicit via Conductor's existing flow.

Type-consistency check:
- `HumanTaskConfig` (slim) used in: human-task converter (Task 4), human-task editor (Task 6), resolve service (Task 10), notify dispatcher (Task 11).
- `WebhookWaitConfig` used in: webhook-wait converter (Task 4), webhook-wait editor (Task 6), matcher (Task 9).
- `HumanTaskSource` narrowed to `"manual" | "timeout"` (Task 3). Resolution rows for `webhook-wait` nodes still carry `source: "webhook"` in the DB (the column accepts the string) — this is fine because the DB column is not typed against `HumanTaskSource` directly.

Deferred (per spec):
- Callback URL endpoint `/callbacks/wait/:id` — not in this plan.
- Slack/email button resolution — not in this plan.
- `webhook-trigger` node type for start-of-flow — not in this plan.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-24-human-task-and-webhook-split.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
