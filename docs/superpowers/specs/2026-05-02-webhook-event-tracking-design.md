# Design: Webhook Event Tracking

**Date:** 2026-05-02  
**Status:** Approved

## Problem

Every pipeline run is triggered by something — a Jira webhook, a GitHub Issues webhook, a Monday webhook, a manual API call — but today that trigger is discarded after the run is created. `jm_runs.trigger_source` stores only the type (`"webhook"`, `"api"`, etc.), not who sent it, what they sent, or which ticket it was about.

With many workflows and many runs, you need to answer:
- Which webhook triggered which run(s)?
- For this run, what was the original payload?
- Which webhooks arrived but matched no flow (misconfiguration)?
- Did this webhook fire twice (duplicate delivery)?
- Show me all events and runs for ticket `jira:PROJ-123`.

## Decision

Introduce a `jm_webhook_events` table. Every inbound trigger is recorded there first, before any run is created. `jm_runs` gains a nullable `webhook_event_id` FK pointing back to it.

The relationship is **1:N** — one webhook event can spawn multiple runs (e.g. same ticket matches two flows). Nullable FK on `jm_runs` covers manual and API-triggered runs that have no webhook.

## Database Schema

### New table: `jm_webhook_events`

```sql
CREATE TABLE IF NOT EXISTS jm_webhook_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider        TEXT        NOT NULL,  -- "jira" | "github" | "monday" | "linear" | "api" | "manual"
  event_type      TEXT,                  -- "new-ticket" | "status-change" | "comment" | null
  delivery_id     TEXT,                  -- webhook delivery ID from provider header (dedup)
  issue_ref       TEXT,                  -- canonical id e.g. "jira:PROJ-123" (nullable until parsed)
  product_id      TEXT,                  -- which product config matched
  raw_headers     JSONB,                 -- sanitised inbound headers (auth/sig headers stripped)
  raw_payload     JSONB       NOT NULL,  -- full raw webhook body
  status          TEXT        NOT NULL DEFAULT 'received',
  error           TEXT                   -- populated when status = 'error'
);

-- Dedup: reject duplicate deliveries from the same provider
CREATE UNIQUE INDEX IF NOT EXISTS jm_webhook_events_delivery_idx
  ON jm_webhook_events (provider, delivery_id)
  WHERE delivery_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS jm_webhook_events_issue_ref_idx   ON jm_webhook_events (issue_ref);
CREATE INDEX IF NOT EXISTS jm_webhook_events_received_at_idx ON jm_webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS jm_webhook_events_product_idx     ON jm_webhook_events (product_id);
CREATE INDEX IF NOT EXISTS jm_webhook_events_status_idx      ON jm_webhook_events (status);
```

**`status` values:**

| Value | Meaning |
|---|---|
| `received` | Arrived, processing not yet complete |
| `processed` | At least one run was created |
| `ignored` | No matching flow found — no run created |
| `error` | Payload parsing or run creation failed |

### Alter `jm_runs`

```sql
ALTER TABLE jm_runs
  ADD COLUMN IF NOT EXISTS webhook_event_id UUID REFERENCES jm_webhook_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jm_runs_webhook_event_idx ON jm_runs (webhook_event_id);
```

Nullable — manual runs and API-triggered runs have no associated webhook event.

Migration file: `packages/migrations/src/sql/008_webhook_events.sql`

## Common Queries

```sql
-- All runs spawned by a specific webhook
SELECT * FROM jm_runs WHERE webhook_event_id = $1;

-- Full context for a run (trigger + payload)
SELECT r.*, w.provider, w.event_type, w.issue_ref, w.raw_payload
FROM jm_runs r
LEFT JOIN jm_webhook_events w ON r.webhook_event_id = w.id
WHERE r.id = $1;

-- All webhook events + run count for a ticket
SELECT w.*, COUNT(r.id) AS run_count
FROM jm_webhook_events w
LEFT JOIN jm_runs r ON r.webhook_event_id = w.id
WHERE w.issue_ref = $1
GROUP BY w.id
ORDER BY w.received_at DESC;

-- Webhooks that matched no flow (debug misconfiguration)
SELECT * FROM jm_webhook_events
WHERE status = 'ignored'
ORDER BY received_at DESC;

-- Failed webhook processing
SELECT * FROM jm_webhook_events
WHERE status = 'error'
ORDER BY received_at DESC;
```

## TypeScript Types

### `packages/core/src/types/webhook.types.ts`

```typescript
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

### `packages/core/src/interfaces/webhook-event-store.interface.ts`

```typescript
export interface IWebhookEventStore {
  create(args: CreateWebhookEventArgs): Promise<WebhookEvent>;
  setStatus(id: string, status: WebhookEventStatus, error?: string): Promise<void>;
  getById(id: string): Promise<WebhookEvent | null>;
  listByIssueRef(issueRef: string): Promise<WebhookEvent[]>;
}
```

Export both from `packages/core/src/index.ts`.

## Ingestion Flow

The webhook route handler (`POST /webhooks/:provider`) follows this sequence:

```
1. HTTP POST arrives
2. Strip auth/signature headers, verify HMAC signature
3. INSERT jm_webhook_events (status = "received", raw_payload, raw_headers, provider, delivery_id)
   → recorded before any further processing; a crash mid-flow still leaves a trace
4. Parse payload → extract issueRef, eventType, productId
5. UPDATE webhook_event SET issue_ref, event_type, product_id
6. Check delivery_id uniqueness — if duplicate: UPDATE status = "ignored", return 200
7. Look up matching flow(s) for productId + eventType
   → none found: UPDATE status = "ignored", return 200
8. For each matching flow:
     INSERT jm_runs with webhook_event_id = event.id
9. UPDATE webhook_event status = "processed"
10. Return 200

On any unhandled error:
  UPDATE webhook_event status = "error", error = message
  Return 200  ← webhooks must always respond 200 to prevent provider retries
```

Step 3 happens unconditionally so even crashes mid-processing leave a full trace.

## Implementation Scope

### New files

| File | Purpose |
|---|---|
| `packages/core/src/types/webhook.types.ts` | `WebhookEvent`, `CreateWebhookEventArgs`, `WebhookEventStatus`, `WebhookProvider` |
| `packages/core/src/interfaces/webhook-event-store.interface.ts` | `IWebhookEventStore` |
| `packages/orchestrator/src/stores/postgres/postgres-webhook-event-store.ts` | `PostgresWebhookEventStore` |
| `packages/orchestrator/src/stores/memory/memory-webhook-event-store.ts` | In-memory impl for tests |
| `packages/migrations/src/sql/008_webhook_events.sql` | New table + alter `jm_runs` |

### Changed files

| File | Change |
|---|---|
| `packages/core/src/index.ts` | Export new types and interface |
| `packages/core/src/types/run.types.ts` | Add `webhookEventId: string \| null` to `Run` |
| `packages/orchestrator/src/stores/postgres/postgres-run-store.ts` | Read/write `webhook_event_id` column |
| `packages/api-server/src/routes/runs.ts` | Expose `webhookEventId` in run API responses |
| `packages/api-server/src/routes/webhooks.ts` *(new)* | `POST /webhooks/:provider` route — HMAC verification + ingestion flow |

## Acceptance Criteria

1. Every inbound webhook is recorded in `jm_webhook_events` before a run is created.
2. Duplicate `delivery_id` from the same provider is rejected (unique index) and the event is marked `ignored`.
3. A webhook that matches no flow is recorded with `status = "ignored"` — not silently dropped.
4. `jm_runs.webhook_event_id` is populated for all webhook-triggered runs; `null` for manual/API runs.
5. `npm run typecheck` passes with zero errors.
6. Migration runs cleanly on an existing database (existing rows get `webhook_event_id = NULL`).
