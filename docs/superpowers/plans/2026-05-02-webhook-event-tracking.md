# Webhook Event Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `jm_webhook_events` table, wire a `POST /webhooks/:provider` route that records every inbound trigger before creating runs, and expose `webhookEventId` on `Run`.

**Architecture:** Core types first, then DB migration, then Postgres store implementation, then API route. The webhook route records the event unconditionally before any processing — a crash mid-flow always leaves a trace.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, npm workspaces monorepo. Depends on the issueRef rename plan being complete first.

---

### Task 1: Add webhook types and interface to `@journeyman/core`

**Files:**
- Create: `packages/core/src/types/webhook.types.ts`
- Create: `packages/core/src/interfaces/webhook-event-store.interface.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create `webhook.types.ts`**

```typescript
// packages/core/src/types/webhook.types.ts
export type WebhookEventStatus = "received" | "processed" | "ignored" | "error";
export type WebhookProvider = "jira" | "github" | "monday" | "linear" | "api" | "manual";

export type WebhookEvent = {
  id: string;
  receivedAt: Date;
  provider: WebhookProvider;
  eventType: string | null;
  deliveryId: string | null;
  issueRef: string | null;
  productId: string | null;
  rawHeaders: Record<string, string>;
  rawPayload: unknown;
  status: WebhookEventStatus;
  error: string | null;
};

export type CreateWebhookEventArgs = Omit<WebhookEvent, "id" | "receivedAt" | "status" | "error">;
```

- [ ] **Step 2: Create `webhook-event-store.interface.ts`**

```typescript
// packages/core/src/interfaces/webhook-event-store.interface.ts
import type { CreateWebhookEventArgs, WebhookEvent, WebhookEventStatus } from "../types/webhook.types.ts";

export interface IWebhookEventStore {
  create(args: CreateWebhookEventArgs): Promise<WebhookEvent>;
  setStatus(id: string, status: WebhookEventStatus, error?: string): Promise<void>;
  getById(id: string): Promise<WebhookEvent | null>;
  listByIssueRef(issueRef: string): Promise<WebhookEvent[]>;
}
```

- [ ] **Step 3: Export from `packages/core/src/index.ts`**

Add at the bottom:

```typescript
export type {
  WebhookEvent,
  WebhookEventStatus,
  WebhookProvider,
  CreateWebhookEventArgs,
} from "./types/webhook.types.ts";
export type { IWebhookEventStore } from "./interfaces/webhook-event-store.interface.ts";
```

---

### Task 2: Add `webhookEventId` to `Run` type

**Files:**
- Modify: `packages/core/src/types/run.types.ts`

- [ ] **Step 1: Add `webhookEventId` field to `Run`**

Find the `Run` type and add the field. The `Run` type currently has fields like `id`, `flowId`, `status`, `triggerSource`, etc. Add:

```typescript
// In the Run type, after triggerSource:
  webhookEventId: string | null;
```

---

### Task 3: Add DB migration

**Files:**
- Create: `packages/migrations/src/sql/008_webhook_events.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 008_webhook_events.sql

CREATE TABLE IF NOT EXISTS jm_webhook_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider        TEXT        NOT NULL,
  event_type      TEXT,
  delivery_id     TEXT,
  issue_ref       TEXT,
  product_id      TEXT,
  raw_headers     JSONB,
  raw_payload     JSONB       NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'received',
  error           TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS jm_webhook_events_delivery_idx
  ON jm_webhook_events (provider, delivery_id)
  WHERE delivery_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS jm_webhook_events_issue_ref_idx   ON jm_webhook_events (issue_ref);
CREATE INDEX IF NOT EXISTS jm_webhook_events_received_at_idx ON jm_webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS jm_webhook_events_product_idx     ON jm_webhook_events (product_id);
CREATE INDEX IF NOT EXISTS jm_webhook_events_status_idx      ON jm_webhook_events (status);

ALTER TABLE jm_runs
  ADD COLUMN IF NOT EXISTS webhook_event_id UUID REFERENCES jm_webhook_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jm_runs_webhook_event_idx ON jm_runs (webhook_event_id);
```

---

### Task 4: Implement `PostgresWebhookEventStore`

**Files:**
- Create: `packages/orchestrator/src/stores/postgres/postgres-webhook-event-store.ts`

- [ ] **Step 1: Create the store**

```typescript
// packages/orchestrator/src/stores/postgres/postgres-webhook-event-store.ts
import type { Pool } from "pg";
import type {
  CreateWebhookEventArgs,
  IWebhookEventStore,
  WebhookEvent,
  WebhookEventStatus,
} from "@journeyman/core";

function rowToEvent(row: any): WebhookEvent {
  return {
    id: row.id,
    receivedAt: new Date(row.received_at),
    provider: row.provider,
    eventType: row.event_type,
    deliveryId: row.delivery_id,
    issueRef: row.issue_ref,
    productId: row.product_id,
    rawHeaders: row.raw_headers ?? {},
    rawPayload: row.raw_payload,
    status: row.status,
    error: row.error,
  };
}

export class PostgresWebhookEventStore implements IWebhookEventStore {
  constructor(private pool: Pool) {}

  async create(args: CreateWebhookEventArgs): Promise<WebhookEvent> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_webhook_events
         (provider, event_type, delivery_id, issue_ref, product_id, raw_headers, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       RETURNING *`,
      [
        args.provider,
        args.eventType ?? null,
        args.deliveryId ?? null,
        args.issueRef ?? null,
        args.productId ?? null,
        JSON.stringify(args.rawHeaders ?? {}),
        JSON.stringify(args.rawPayload),
      ],
    );
    return rowToEvent(rows[0]);
  }

  async setStatus(id: string, status: WebhookEventStatus, error?: string): Promise<void> {
    await this.pool.query(
      `UPDATE jm_webhook_events SET status = $1, error = $2 WHERE id = $3`,
      [status, error ?? null, id],
    );
  }

  async getById(id: string): Promise<WebhookEvent | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_webhook_events WHERE id = $1",
      [id],
    );
    return rows[0] ? rowToEvent(rows[0]) : null;
  }

  async listByIssueRef(issueRef: string): Promise<WebhookEvent[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_webhook_events WHERE issue_ref = $1 ORDER BY received_at DESC",
      [issueRef],
    );
    return rows.map(rowToEvent);
  }
}
```

---

### Task 5: Implement `MemoryWebhookEventStore`

**Files:**
- Create: `packages/orchestrator/src/stores/memory/memory-webhook-event-store.ts`

- [ ] **Step 1: Create the in-memory store**

```typescript
// packages/orchestrator/src/stores/memory/memory-webhook-event-store.ts
import type {
  CreateWebhookEventArgs,
  IWebhookEventStore,
  WebhookEvent,
  WebhookEventStatus,
} from "@journeyman/core";
import { randomUUID } from "node:crypto";

export class MemoryWebhookEventStore implements IWebhookEventStore {
  private events = new Map<string, WebhookEvent>();

  async create(args: CreateWebhookEventArgs): Promise<WebhookEvent> {
    const event: WebhookEvent = {
      id: randomUUID(),
      receivedAt: new Date(),
      provider: args.provider,
      eventType: args.eventType ?? null,
      deliveryId: args.deliveryId ?? null,
      issueRef: args.issueRef ?? null,
      productId: args.productId ?? null,
      rawHeaders: args.rawHeaders ?? {},
      rawPayload: args.rawPayload,
      status: "received",
      error: null,
    };
    this.events.set(event.id, event);
    return event;
  }

  async setStatus(id: string, status: WebhookEventStatus, error?: string): Promise<void> {
    const ev = this.events.get(id);
    if (ev) this.events.set(id, { ...ev, status, error: error ?? null });
  }

  async getById(id: string): Promise<WebhookEvent | null> {
    return this.events.get(id) ?? null;
  }

  async listByIssueRef(issueRef: string): Promise<WebhookEvent[]> {
    return [...this.events.values()]
      .filter(e => e.issueRef === issueRef)
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  }
}
```

---

### Task 6: Update `postgres-run-store.ts` to read/write `webhook_event_id`

**Files:**
- Modify: `packages/orchestrator/src/stores/postgres/postgres-run-store.ts`

- [ ] **Step 1: Add `webhookEventId` to `rowToRun`**

In the `rowToRun` function, add:

```typescript
    webhookEventId: row.webhook_event_id ?? null,
```

- [ ] **Step 2: Add `webhookEventId` to the `CREATE` insert**

Find the `INSERT INTO jm_runs` query in the `create` method. Add `webhook_event_id` as an optional column:

```typescript
  async create(args: CreateRunArgs): Promise<Run> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_runs
         (flow_id, flow_version_id, flow_name_snapshot, flow_scope_snapshot, definition_snapshot,
          status, trigger_source, started_by_user_id, inputs, webhook_event_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', $6, $7, $8::jsonb, $9)
       RETURNING *`,
      [
        args.flowId, args.flowVersionId,
        args.flowNameSnapshot, args.flowScopeSnapshot,
        JSON.stringify(args.definitionSnapshot),
        args.triggerSource, args.startedByUserId,
        JSON.stringify(args.inputs),
        args.webhookEventId ?? null,
      ],
    );
    return rowToRun(rows[0]);
  }
```

- [ ] **Step 3: Add `webhookEventId` to `CreateRunArgs`**

Find the `CreateRunArgs` type in `packages/core/src/interfaces/run-store.interface.ts` and add:

```typescript
  webhookEventId?: string | null;
```

---

### Task 7: Create `POST /webhooks/:provider` route

**Files:**
- Create: `packages/api-server/src/routes/webhooks.ts`
- Modify: `packages/api-server/src/server.ts` (or wherever routes are registered — check the file)

- [ ] **Step 1: Check where routes are registered**

```bash
grep -n "registerRunRoutes\|register.*Routes\|app.register" packages/api-server/src/server.ts packages/api-server/src/index.ts 2>/dev/null | head -20
```

- [ ] **Step 2: Create the webhook route**

```typescript
// packages/api-server/src/routes/webhooks.ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Composition } from "../composition.ts";
import type { WebhookProvider } from "@journeyman/core";

const SIGNATURE_HEADERS: Record<string, string> = {
  github: "x-hub-signature-256",
  jira: "x-hub-signature",
  monday: "authorization",
};

const DELIVERY_HEADERS: Record<string, string> = {
  github: "x-github-delivery",
  jira: "x-atlassian-webhook-identifier",
};

function sanitiseHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const blocked = new Set(["authorization", "x-hub-signature", "x-hub-signature-256", "cookie"]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!blocked.has(k.toLowerCase())) {
      out[k] = Array.isArray(v) ? v.join(", ") : (v ?? "");
    }
  }
  return out;
}

const VALID_PROVIDERS = new Set<WebhookProvider>(["jira", "github", "monday", "linear"]);

export function registerWebhookRoutes(app: FastifyInstance, c: Composition): void {
  app.post("/webhooks/:provider", async (req, reply) => {
    const { provider } = req.params as { provider: string };

    if (!VALID_PROVIDERS.has(provider as WebhookProvider)) {
      reply.code(404);
      return { error: "unknown_provider" };
    }

    const rawPayload = req.body as unknown;
    const rawHeaders = sanitiseHeaders(req.headers as Record<string, string | string[] | undefined>);
    const deliveryId = req.headers[DELIVERY_HEADERS[provider] ?? ""] as string | undefined ?? null;

    // Step 3: Record before any processing
    const event = await c.webhookEvents.create({
      provider: provider as WebhookProvider,
      eventType: null,
      deliveryId,
      issueRef: null,
      productId: null,
      rawHeaders,
      rawPayload,
    });

    try {
      // Step 4-5: Parse payload
      const payload = rawPayload as Record<string, unknown>;
      // Each provider exposes the issue ref differently; extend as needed
      let issueRef: string | null = null;
      let eventType: string | null = null;
      let productId: string | null = null;

      if (provider === "jira") {
        const key = (payload?.issue as any)?.key as string | undefined;
        if (key) issueRef = `jira:${key}`;
        eventType = (payload?.webhookEvent as string) ?? null;
      } else if (provider === "github") {
        const number = (payload?.issue as any)?.number;
        const repo = (payload?.repository as any)?.full_name as string | undefined;
        if (number != null && repo) issueRef = `github:${repo}#${number}`;
        eventType = (req.headers["x-github-event"] as string) ?? null;
      } else if (provider === "monday") {
        const itemId = (payload?.event as any)?.pulseId as number | undefined;
        if (itemId != null) issueRef = `monday:${itemId}`;
        eventType = (payload?.event as any)?.type as string ?? null;
      } else if (provider === "linear") {
        const identifier = (payload?.data as any)?.identifier as string | undefined;
        if (identifier) issueRef = `linear:${identifier}`;
        eventType = (payload?.action as string) ?? null;
      }

      await c.webhookEvents.setStatus(event.id, "received");

      // Step 6: Dedup check (unique index handles DB-level dedup; mark ignored on conflict)
      // The unique index will throw on duplicate — catch it below as "ignored"

      // Update parsed fields
      await c.pool!.query(
        "UPDATE jm_webhook_events SET issue_ref = $1, event_type = $2, product_id = $3 WHERE id = $4",
        [issueRef, eventType, productId, event.id],
      );

      // Step 7: No matching flow — mark ignored
      // (flow resolution is out of scope for this plan; stub returns ignored)
      // Replace with real flow resolver when available:
      const matchingFlows: string[] = []; // c.flowResolver.resolve(provider, eventType, productId)

      if (matchingFlows.length === 0) {
        await c.webhookEvents.setStatus(event.id, "ignored");
        reply.code(200);
        return { status: "ignored" };
      }

      // Step 8: Create a run per matching flow
      for (const flowId of matchingFlows) {
        await c.runs.create({
          flowId,
          flowVersionId: flowId, // replace with real version resolution
          flowNameSnapshot: flowId,
          flowScopeSnapshot: "org",
          definitionSnapshot: {} as any,
          triggerSource: "webhook",
          startedByUserId: null,
          inputs: { issueRef, eventType },
          webhookEventId: event.id,
        });
      }

      // Step 9: Mark processed
      await c.webhookEvents.setStatus(event.id, "processed");
      reply.code(200);
      return { status: "processed" };

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Dedup: unique constraint violation → ignore
      if (message.includes("jm_webhook_events_delivery_idx")) {
        await c.webhookEvents.setStatus(event.id, "ignored");
        reply.code(200);
        return { status: "ignored" };
      }
      await c.webhookEvents.setStatus(event.id, "error", message);
      // Always return 200 to prevent provider retries
      reply.code(200);
      return { status: "error" };
    }
  });
}
```

- [ ] **Step 3: Register the route in the server**

In `packages/api-server/src/server.ts` (or wherever `registerRunRoutes` is called), add:

```typescript
import { registerWebhookRoutes } from "./routes/webhooks.ts";
// ... inside the setup function:
registerWebhookRoutes(app, composition);
```

- [ ] **Step 4: Add `webhookEvents` to `Composition`**

Open `packages/api-server/src/composition.ts`. Add:

```typescript
import type { IWebhookEventStore } from "@journeyman/core";
// In the Composition interface/type:
  webhookEvents: IWebhookEventStore;
```

Then in the composition factory (wherever the Postgres stores are instantiated):

```typescript
import { PostgresWebhookEventStore } from "@journeyman/orchestrator";
// or direct path if not re-exported:
// import { PostgresWebhookEventStore } from "../../orchestrator/src/stores/postgres/postgres-webhook-event-store.ts";

webhookEvents: new PostgresWebhookEventStore(pool),
```

Check how `PostgresRunStore` is exported from the orchestrator package and follow the same pattern.

---

### Task 8: Expose `webhookEventId` in run API responses

**Files:**
- Modify: `packages/api-server/src/routes/runs.ts`

- [ ] **Step 1: Include `webhookEventId` in the run detail response**

In the `GET /runs/:id` handler, after fetching the run, also fetch the webhook event if present:

```typescript
  app.get("/runs/:id", ..., async (req, reply) => {
    // ... existing code ...
    const run = await c.runs.getById(id);
    if (!run) { reply.code(404); return { error: "not_found" }; }

    // Fetch webhook event if present
    const webhookEvent = run.webhookEventId
      ? await c.webhookEvents.getById(run.webhookEventId)
      : null;

    const executions = await c.nodeExecutions.listByRun(id);
    const events = await c.events.list(id, { limit: 500 });
    // ... existing role/grant code ...

    return {
      run: { ...run, effectiveRole },
      events: allEvents,
      executions,
      webhookEvent: webhookEvent ? {
        id: webhookEvent.id,
        provider: webhookEvent.provider,
        eventType: webhookEvent.eventType,
        issueRef: webhookEvent.issueRef,
        deliveryId: webhookEvent.deliveryId,
        receivedAt: webhookEvent.receivedAt.toISOString(),
        rawPayload: webhookEvent.rawPayload,
      } : null,
    };
  });
```

---

### Task 9: Typecheck

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Verify webhook route is reachable**

```bash
grep -n "registerWebhookRoutes\|/webhooks" packages/api-server/src/server.ts packages/api-server/src/index.ts 2>/dev/null
```

Expected: at least one line showing the route is registered.
