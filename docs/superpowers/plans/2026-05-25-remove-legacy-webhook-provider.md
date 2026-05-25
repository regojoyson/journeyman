# Remove Legacy Webhook Provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip the legacy `provider` field from `WebhookWaitConfig`, the `POST /webhooks/:provider` ingest route, the "Legacy provider" UI section, and the conductor converter's provider-based validation. `webhookId` becomes the only way a webhook-wait node identifies its source.

**Architecture:** Direct surgical removal across four packages — `@journeyman/core` (type change), `@journeyman/orchestrator` (converter + migrator), `@journeyman/api-server` (route file shrinks), `@journeyman/flow-editor` (UI section). No new code; just deletion and one type-field rename.

**Tech Stack:** TypeScript NodeNext ESM.

**Spec:** [`docs/superpowers/specs/2026-05-25-remove-legacy-webhook-provider-design.md`](../specs/2026-05-25-remove-legacy-webhook-provider-design.md)

**Project constraints (overrides skill defaults):**

- **No commits** during implementation.
- **No unit tests** added or modified.
- **Verification at end only**: `npm run check` (typecheck + import boundaries).

---

## File Structure

```
packages/core/src/types/
  └── webhook-wait.types.ts                            ← modify — swap provider → webhookId

packages/orchestrator/src/flow-json/
  ├── conductor-converter.ts                           ← modify — emitWebhookWait swap
  └── migrate-human-task-to-webhook-wait.ts            ← modify — drop provider copy + inferProvider helper

packages/api-server/src/routes/
  └── webhooks.ts                                      ← modify — delete legacy handler + helpers

packages/flow-editor/src/properties-panel/
  └── WebhookWaitConfigEditor.tsx                      ← modify — delete PROVIDERS + Legacy block
```

Each file's responsibility is unchanged; only the legacy code paths are deleted.

---

### Task 1: Update `WebhookWaitConfig` type

**Files:**
- Modify: `packages/core/src/types/webhook-wait.types.ts`

- [ ] **Step 1: Replace the file**

```ts
import type { JsonLogicExpr } from "./flow-condition.types.ts";

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
  /** Registered webhook this node listens to. Required at publish time. */
  webhookId: string;
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

The `import type { WebhookProvider }` line is removed (no longer referenced from this file).

---

### Task 2: Update conductor converter to use `webhookId`

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts` (the `emitWebhookWait` method around line 363–395)

- [ ] **Step 1: Replace the `emitWebhookWait` method body**

Find the existing method:

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

Replace with:

```ts
  emitWebhookWait(node: WorkflowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const cfg = (node.config ?? {}) as Partial<import("@journeyman/core").WebhookWaitConfig>;

    if (!cfg.webhookId) {
      throw new WorkflowValidationError(`Webhook-wait ${this.label(node)} must reference a webhookId`);
    }

    const outputs = Array.isArray(cfg.outputs) ? cfg.outputs : [];
    this.validateOutputNames(node, outputs, ["source", "resolvedAt", "webhookEventId", "payload"], "Webhook-wait");

    const human: import("./conductor-types.ts").HumanTask = {
      type: "HUMAN",
      name: `webhookwait_${node.id}`,
      taskReferenceName: node.id,
      inputParameters: {
        outputs,
        webhookId: cfg.webhookId,
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

Two edits: the validation check (`!cfg.provider` → `!cfg.webhookId` with new message) and the input-parameters key (`provider: cfg.provider` → `webhookId: cfg.webhookId`).

Note: the unrelated `kindProviders` loop earlier in the file (around line 228, scanning `flow.defaults?.executorConfig`) deals with *step executor* providers (github vs gitlab for git ops) — completely separate from webhook-wait. Leave it alone.

---

### Task 3: Update human-task → webhook-wait migrator

**Files:**
- Modify: `packages/orchestrator/src/flow-json/migrate-human-task-to-webhook-wait.ts`

- [ ] **Step 1: Replace the file**

```ts
import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";

/**
 * Read-time migration: any node with type "human-task" that carries the
 * legacy webhook-matching fields (listensFor, acceptIf, or outputs with
 * fromPath) is converted in-memory to a "webhook-wait" node.
 *
 * Pure: returns a new graph; does not mutate input. Stored definitions on
 * disk are unchanged — callers do this on every read.
 *
 * The converted node has no `webhookId` set — the author must pick a
 * registered webhook in the editor before the flow can be published.
 * (Pre-product cleanup: legacy provider auto-inference has been removed.)
 */
export function migrateHumanTaskToWebhookWait(graph: WorkflowGraph): WorkflowGraph {
  let changed = false;
  const nodes: WorkflowNode[] = graph.nodes.map((node) => {
    if (node.type !== "human-task") return node;

    const cfg = (node.config ?? {}) as Record<string, unknown>;
    const outputs = Array.isArray(cfg.outputs) ? cfg.outputs as Array<Record<string, unknown>> : [];
    const hasListensFor = Array.isArray(cfg.listensFor) && (cfg.listensFor as unknown[]).length > 0;
    const hasAcceptIf = cfg.acceptIf != null;
    const hasFromPath = outputs.some((o) => typeof o.fromPath === "string" && (o.fromPath as string).length > 0);

    if (!hasListensFor && !hasAcceptIf && !hasFromPath) return node;

    const nextConfig: Record<string, unknown> = {
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
```

Removed: the `provider` field from `nextConfig`, and the entire `inferProvider` helper function.

---

### Task 4: Trim the webhooks route file

**Files:**
- Modify: `packages/api-server/src/routes/webhooks.ts`

- [ ] **Step 1: Replace the entire file**

```ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Composition } from "../composition.ts";
import { ingestForWebhook } from "../services/webhook-ingest.ts";

function rawBodyOf(req: FastifyRequest): Buffer {
  const body = req.body as unknown;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  return Buffer.from(JSON.stringify(body ?? {}), "utf8");
}

export function registerWebhookRoutes(app: FastifyInstance, c: Composition): void {
  // Universal ingest using the webhook registry. Each registered webhook
  // gets a unique tenantToken; lookup → verify → schema-check → match
  // happens inside ingestForWebhook.
  app.post("/webhooks/in/:tenantToken", async (req, reply) => {
    const { tenantToken } = req.params as { tenantToken: string };
    const webhook = await c.webhooks.getByTenantToken(tenantToken);
    if (!webhook) {
      reply.code(404);
      return { error: "unknown_webhook" };
    }

    const result = await ingestForWebhook(c, c.pool, {
      webhook,
      rawBody: rawBodyOf(req),
      rawPayload: req.body as unknown,
      headers: req.headers as Record<string, string | string[] | undefined>,
    });

    switch (result.status) {
      case "auth_failed":
        reply.code(401);
        return { error: "auth_failed", reason: result.reason };
      case "schema_invalid":
        reply.code(400);
        return { error: "schema_invalid", reason: result.reason, eventId: result.eventId };
      case "resolved":
        reply.code(200);
        return { status: "resolved", matched: result.matched, eventId: result.eventId };
      case "processed":
        reply.code(200);
        return { status: "processed", eventId: result.eventId };
      case "ignored":
        reply.code(200);
        return { status: "ignored", eventId: result.eventId };
      case "error":
        reply.code(200);
        return { status: "error", reason: result.reason, eventId: result.eventId };
    }
  });
}
```

What's gone:

- `app.post("/webhooks/:provider", …)` handler (the entire ~80-line block).
- `DELIVERY_HEADERS`, `VALID_PROVIDERS`, `BLOCKED_HEADERS` constants.
- `sanitiseHeaders` function.
- `import type { WebhookProvider } from "@journeyman/core"`.
- `import { matchAndResolveWebhookWaits } from "../services/match-human-tasks.ts"`.

The file shrinks to ~50 lines. `webhook-ingest.ts` still has its own header-sanitization and the call into the matcher, so deleting these here doesn't break the new path.

---

### Task 5: Remove the "Legacy provider" UI section

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx`

- [ ] **Step 1: Delete the `PROVIDERS` constant**

Find and delete this line (around line 21):

```ts
const PROVIDERS = ["jira", "github", "gitlab", "monday", "linear", "api"] as const;
```

- [ ] **Step 2: Drop `provider` from the `cfg` type cast**

Find the `cfg` cast inside the component (around line 24–32):

```ts
  const cfg = (node.config ?? {}) as {
    webhookId?: string;
    provider?: string;
    listensFor?: string[];
    acceptIf?: unknown;
    correlationKey?: "issueRef";
    outputs?: WebhookWaitOutputCfg[];
    timeout?: { duration: string; defaults?: Record<string, unknown> };
  };
```

Replace with:

```ts
  const cfg = (node.config ?? {}) as {
    webhookId?: string;
    listensFor?: string[];
    acceptIf?: unknown;
    correlationKey?: "issueRef";
    outputs?: WebhookWaitOutputCfg[];
    timeout?: { duration: string; defaults?: Record<string, unknown> };
  };
```

- [ ] **Step 3: Delete the "Legacy provider (un-migrated)" `<div>` block**

Find and delete the entire conditional (currently between the Webhook picker and the "Listens for" field, roughly lines 100–116):

```tsx
      {!cfg.webhookId && (
        <div className="je-field">
          <label className="je-field__label">Legacy provider (un-migrated)</label>
          <select
            value={cfg.provider ?? ""}
            disabled={readOnly}
            onChange={(e) => update({ provider: e.target.value })}
          >
            <option value="">— pick a provider —</option>
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <p className="je-hint">
            For nodes still wired to the legacy <code>/webhooks/:provider</code> URL.
            Prefer a registered webhook above.
          </p>
        </div>
      )}
```

- [ ] **Step 4: Adjust the hint text on the webhook picker**

The current picker has this hint:

```tsx
        <p className="je-hint">
          {selectedWebhook
            ? `Schema-aware. ${suggestedPaths.length} paths suggested below.`
            : "Pick a registered webhook to enable autocomplete on fromPath fields."}
        </p>
```

Replace the empty-state message so authors know a webhook is **required**, not optional:

```tsx
        <p className="je-hint">
          {selectedWebhook
            ? `Schema-aware. ${suggestedPaths.length} paths suggested below.`
            : "Pick a registered webhook — required to publish this node."}
        </p>
```

---

### Task 6: Final verification

**Files:** none.

- [ ] **Step 1: Confirm no stale references remain**

```bash
grep -rn "WebhookWaitConfig.*provider\|cfg\.provider" packages/flow-editor/src packages/orchestrator/src/flow-json packages/core/src/types/webhook-wait.types.ts 2>&1
```

Expected: no matches in `webhook-wait` contexts. (Generic step-executor `provider` references in `executor-config` code remain; that's a different field.)

```bash
grep -n "VALID_PROVIDERS\|/webhooks/:provider" packages/api-server/src/routes/webhooks.ts
```

Expected: no matches.

- [ ] **Step 2: Typecheck the four touched packages**

```bash
npm run typecheck -w @journeyman/core
npm run typecheck -w @journeyman/orchestrator
npm run typecheck -w @journeyman/api-server
npm run typecheck -w @journeyman/flow-editor
```

Expected: each prints `tsc --noEmit` with zero errors.

- [ ] **Step 3: Full repo check**

```bash
npm run check
```

Expected: typecheck passes across all workspaces, then prints `✓ Layer boundaries clean across all packages.`

- [ ] **Step 4: Manual smoke confirmation (optional)**

1. Boot the api-server. `curl -X POST http://localhost:3000/webhooks/github -d '{}' -H 'Content-Type: application/json'` → 404 from Fastify (no route matches).
2. `curl -X POST http://localhost:3000/webhooks/in/<token>` with a valid signed payload → 200 as before.
3. Open the flow-editor on a workflow with a webhook-wait node → only the Webhook dropdown is visible, no "Legacy provider" field. With nothing selected, the hint reads "Pick a registered webhook — required to publish this node."
4. Try to publish a flow whose webhook-wait has no `webhookId` → publish fails with `Webhook-wait <node> must reference a webhookId`.

---

## Plan Self-Review

**Spec coverage:**

| Spec item | Task(s) |
|---|---|
| Drop `provider` from `WebhookWaitConfig`, add `webhookId` required | 1 |
| Converter: validate `webhookId` not `provider`; emit `webhookId` not `provider` | 2 |
| Migrator: stop synthesizing `provider` for converted nodes | 3 |
| Delete legacy `POST /webhooks/:provider` route + helpers | 4 |
| Delete "Legacy provider" UI block + `PROVIDERS` constant + `cfg.provider` | 5 |
| Keep `WebhookProvider` union (events table tag) — *no task needed*, untouched | — |
| Keep `WebhookEvent.provider` column — *no task needed*, untouched | — |
| Verification: `npm run check` is the gate | 6 |

**Placeholder scan:** No "TBD" / "fill in details" / vague-instruction patterns. Each modify step shows the exact code to remove and (where applicable) the replacement.

**Type consistency:** `webhookId` is `string` everywhere it's used in the new code (Task 1, 2). The converter's `inputParameters` is `Record<string, unknown>` (unchanged shape), so adding `webhookId` and removing `provider` doesn't require a type change in `conductor-types.ts`. The UI's `cfg` type cast in Task 5 matches the trimmed `WebhookWaitConfig` from Task 1 (modulo optional vs required — UI keeps `webhookId?: string` because authoring is incremental; publish-time enforcement happens in the converter).

---

## Execution Handoff

Plan complete and saved to [`docs/superpowers/plans/2026-05-25-remove-legacy-webhook-provider.md`](2026-05-25-remove-legacy-webhook-provider.md).

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task with review checkpoints.
2. **Inline Execution** — I work through tasks here via `superpowers:executing-plans`.

Which approach?
