# Webhook recent-events table with pagination

**Date:** 2026-05-30
**Status:** Approved (design)

## Problem

The webhook detail page has a **Recent events** tab, but it is a placeholder. The
client function `listRecentEventsForWebhook()` in `packages/web/src/api/webhooks.ts`
hard-returns `[]`, and `WebhookEventsTab.tsx` renders copy explaining that a dedicated
endpoint "isn't part of plan 2's surface". There is no way for a user to see the events
a webhook has actually received.

Events *are* persisted: `ingestForWebhook` writes every delivery to `jm_webhook_events`
with a `webhook_id` FK. We need to surface them in a paginated table, with the ability
to inspect an event's raw payload and headers for debugging.

## Goal

Replace the placeholder tab with a paginated table of the webhook's received events,
newest first, where clicking a row reveals the stored raw payload and headers.

## Non-goals

- No live streaming / auto-polling — refresh is manual (a button).
- No status filtering, search, or date-range filtering (YAGNI for v1).
- No cursor pagination — page-number offset matches the existing convention.
- No new migration — the table, FK, and indexes already exist.

## Existing context

- **Table** `jm_webhook_events` (migration `008_webhook_events.sql`, FK added in
  `027_webhooks.sql`): has `webhook_id` (indexed via `jm_webhook_events_webhook_id_idx`)
  and `received_at DESC` index. Paginating by webhook ordered by `received_at` is cheap.
- **Type** `WebhookEvent` (`packages/core/src/types/webhook.types.ts`) already includes
  `rawPayload` and `rawHeaders`. Sensitive headers are stripped at ingest time by
  `sanitiseHeaders`, so returning headers is safe.
- **Pagination convention** (see `2026-05-13-list-pagination-design.md` and
  `listRunsPaged` in `packages/web/src/api/runs.ts` / the `/workflow-instances` route):
  query params `page` / `page_size`; response `{ <items>, total, page, pageSize }`;
  server clamps `page = max(1, …)` and `pageSize = min(100, max(1, requested ?? 25))`.

## Design

### 1. Data layer — `IWebhookEventStore`

Add two methods to `packages/core/src/interfaces/webhook-event-store.interface.ts`:

```ts
listByWebhook(webhookId: string, opts: { limit: number; offset: number }): Promise<WebhookEvent[]>;
countByWebhook(webhookId: string): Promise<number>;
```

**Postgres** (`postgres-webhook-event-store.ts`):

```sql
SELECT * FROM jm_webhook_events
  WHERE webhook_id = $1
  ORDER BY received_at DESC
  LIMIT $2 OFFSET $3;

SELECT COUNT(*) FROM jm_webhook_events WHERE webhook_id = $1;
```

Both hit existing indexes. Reuse the existing `rowToEvent` mapper.

**Memory** (`memory-webhook-event-store.ts`): filter the in-memory array by `webhookId`,
sort by `receivedAt` descending, then slice `[offset, offset + limit]`; count is the
filtered length.

No migration required.

### 2. API endpoint

New route in `packages/api-server/src/routes/webhooks-management.ts`:

```
GET /api/webhooks/:id/events?page=1&page_size=25
```

- `preHandler: requireAuth()`, then the existing `load(req, id)` helper enforces
  org/user ownership → 404 (`not_found`) / 403 (`forbidden`), consistent with the other
  by-id routes.
- Parse paging exactly like the `/workflow-instances` route:
  `page = max(1, Number(page ?? 1) || 1)`,
  `pageSize = min(100, max(1, Number(page_size ?? 25) || 25))`,
  `offset = (page - 1) * pageSize`.
- `Promise.all([ c.webhookEvents.listByWebhook(id, { limit: pageSize, offset }),
  c.webhookEvents.countByWebhook(id) ])`.
- Response:

```ts
{ events: WebhookEvent[]; total: number; page: number; pageSize: number }
```

`rawPayload` / `rawHeaders` ship in the list response (rows are capped by `pageSize`),
so the drill-down needs no second request.

### 3. Typed client

In `packages/web/src/api/webhooks.ts`, replace the stub `listRecentEventsForWebhook`
with:

```ts
export interface PagedWebhookEvents {
  events: WebhookEvent[];
  total: number;
  page: number;
  pageSize: number;
}

export function listWebhookEvents(
  webhookId: string,
  args: { page: number; pageSize: number },
): Promise<PagedWebhookEvents> {
  const qs = new URLSearchParams();
  qs.set("page", String(args.page));
  qs.set("page_size", String(args.pageSize));
  return api<PagedWebhookEvents>(`/api/webhooks/${encodeURIComponent(webhookId)}/events?${qs}`);
}
```

### 4. Table UI

Rewrite `packages/web/src/routes/webhooks/WebhookEventsTab.tsx`:

- **State**: `page`, `events`, `total`, `loading`, `error`, `expandedId`.
  `pageSize = 25` constant. Fetch on mount and whenever `page` changes.
- **Columns**: Event type · Status (small colored badge) · Delivery ID · Received at
  (localized via `toLocaleString()`).
- **Drill-down**: clicking a row toggles `expandedId`; the expanded panel renders
  `rawPayload` and `rawHeaders` as pretty-printed JSON (`<pre>{JSON.stringify(v, null, 2)}</pre>`).
- **Pagination footer**: "Showing X–Y of `total`" with Prev/Next buttons. Prev disabled
  on page 1; Next disabled when `page * pageSize >= total`.
- **Refresh**: a "Refresh" button re-fetches the current page.
- **Empty state**: "No events received yet."
- Styling reuses the existing Tailwind/slate classes already in the file and the
  `text-red-400` error pattern from `WebhookDetailPage`.

## Error handling

- **API**: invalid/out-of-range paging is clamped, not rejected. Missing/unowned webhook
  → 404 / 403 via `load()`.
- **UI**: a failed fetch sets an inline error message; the load uses the existing
  "Loading…" text.

## Testing

- **Store (memory)**: unit-test `listByWebhook` / `countByWebhook` — descending order,
  pagination slicing, and isolation between two different `webhookId`s. Postgres mirrors
  the same contract.
- **API**: route test — seed events for two webhooks under different scopes; assert
  pagination math (`total`, `page`, `pageSize`), newest-first ordering, and that another
  scope's webhook id returns 403/404.
- **UI**: exercised manually via the preview (table render, row expand, prev/next,
  refresh, empty state).

## Files touched

- `packages/core/src/interfaces/webhook-event-store.interface.ts` — interface methods
- `packages/orchestrator/src/stores/postgres/postgres-webhook-event-store.ts` — impl
- `packages/orchestrator/src/stores/memory/memory-webhook-event-store.ts` — impl
- `packages/api-server/src/routes/webhooks-management.ts` — new route
- `packages/web/src/api/webhooks.ts` — client (`listWebhookEvents`, drop the stub)
- `packages/web/src/routes/webhooks/WebhookEventsTab.tsx` — table UI
- Test files alongside the store and route.
