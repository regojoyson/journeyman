# Webhook Recent-Events Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder "Recent events" webhook tab with a paginated table of received events whose rows expand to show the raw payload and headers.

**Architecture:** Add `listByWebhook` / `countByWebhook` to `IWebhookEventStore` (Postgres + memory impls), expose them through a new `GET /api/webhooks/:id/events` route guarded by the existing ownership `load()` helper, add a typed `listWebhookEvents` client, and rewrite `WebhookEventsTab.tsx` as a table with prev/next pagination, a manual refresh button, and inline payload drill-down.

**Tech Stack:** TypeScript, Fastify, `pg`, React + Tailwind, Vitest.

> **Execution note (per user):** Do NOT commit during execution. Run `npm run typecheck` once at the very end (final task).

---

### Task 1: Add store interface methods + TDD the memory store

**Files:**
- Modify: `packages/core/src/interfaces/webhook-event-store.interface.ts`
- Modify: `packages/orchestrator/src/stores/memory/memory-webhook-event-store.ts`
- Create: `packages/orchestrator/src/stores/memory/memory-webhook-event-store.test.ts`

- [ ] **Step 1: Add the two interface methods**

In `packages/core/src/interfaces/webhook-event-store.interface.ts`, replace the interface body with:

```ts
import type { CreateWebhookEventArgs, WebhookEvent, WebhookEventStatus } from "../types/webhook.types.ts";

export interface IWebhookEventStore {
  create(args: CreateWebhookEventArgs): Promise<WebhookEvent>;
  setStatus(id: string, status: WebhookEventStatus, error?: string): Promise<void>;
  getById(id: string): Promise<WebhookEvent | null>;
  /** Events for one webhook, newest first, paginated. */
  listByWebhook(webhookId: string, opts: { limit: number; offset: number }): Promise<WebhookEvent[]>;
  /** Total event count for one webhook (for pagination). */
  countByWebhook(webhookId: string): Promise<number>;
}
```

- [ ] **Step 2: Write the failing memory-store test**

Create `packages/orchestrator/src/stores/memory/memory-webhook-event-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { WebhookEvent } from "@journeyman/core";
import { MemoryWebhookEventStore } from "./memory-webhook-event-store.ts";

function seed(store: MemoryWebhookEventStore, id: string, webhookId: string | null, receivedAt: Date): void {
  const ev: WebhookEvent = {
    id,
    receivedAt,
    webhookId,
    provider: "api",
    eventType: "test",
    deliveryId: null,
    productId: null,
    rawHeaders: {},
    rawPayload: { id },
    status: "received",
    error: null,
  };
  (store as unknown as { events: Map<string, WebhookEvent> }).events.set(id, ev);
}

describe("MemoryWebhookEventStore.listByWebhook / countByWebhook", () => {
  let store: MemoryWebhookEventStore;

  beforeEach(() => {
    store = new MemoryWebhookEventStore();
    // Three events for wh-1, one for wh-2.
    seed(store, "a", "wh-1", new Date("2026-05-30T10:00:00Z"));
    seed(store, "b", "wh-1", new Date("2026-05-30T12:00:00Z"));
    seed(store, "c", "wh-1", new Date("2026-05-30T11:00:00Z"));
    seed(store, "d", "wh-2", new Date("2026-05-30T13:00:00Z"));
  });

  it("returns only the requested webhook's events, newest first", async () => {
    const rows = await store.listByWebhook("wh-1", { limit: 10, offset: 0 });
    expect(rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("applies limit and offset against the newest-first order", async () => {
    const page2 = await store.listByWebhook("wh-1", { limit: 1, offset: 1 });
    expect(page2.map((r) => r.id)).toEqual(["c"]);
  });

  it("counts only the requested webhook's events", async () => {
    expect(await store.countByWebhook("wh-1")).toBe(3);
    expect(await store.countByWebhook("wh-2")).toBe(1);
    expect(await store.countByWebhook("wh-none")).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/orchestrator && npx vitest run src/stores/memory/memory-webhook-event-store.test.ts`
Expected: FAIL — `store.listByWebhook is not a function`.

- [ ] **Step 4: Implement the memory methods**

In `packages/orchestrator/src/stores/memory/memory-webhook-event-store.ts`, add these two methods to the class (after `getById`):

```ts
  async listByWebhook(webhookId: string, opts: { limit: number; offset: number }): Promise<WebhookEvent[]> {
    return [...this.events.values()]
      .filter((e) => e.webhookId === webhookId)
      .sort((a, b) => {
        const d = b.receivedAt.getTime() - a.receivedAt.getTime();
        return d !== 0 ? d : (a.id < b.id ? 1 : -1);
      })
      .slice(opts.offset, opts.offset + opts.limit);
  }

  async countByWebhook(webhookId: string): Promise<number> {
    let n = 0;
    for (const e of this.events.values()) if (e.webhookId === webhookId) n++;
    return n;
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/orchestrator && npx vitest run src/stores/memory/memory-webhook-event-store.test.ts`
Expected: PASS (3 tests).

---

### Task 2: Implement the Postgres store methods

**Files:**
- Modify: `packages/orchestrator/src/stores/postgres/postgres-webhook-event-store.ts`

- [ ] **Step 1: Add `listByWebhook` and `countByWebhook`**

In `packages/orchestrator/src/stores/postgres/postgres-webhook-event-store.ts`, add to the class (after `getById`). They reuse the existing `rowToEvent` mapper and hit the `jm_webhook_events_webhook_id_idx` + `jm_webhook_events_received_at_idx` indexes:

```ts
  async listByWebhook(webhookId: string, opts: { limit: number; offset: number }): Promise<WebhookEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_webhook_events
         WHERE webhook_id = $1
         ORDER BY received_at DESC
         LIMIT $2 OFFSET $3`,
      [webhookId, opts.limit, opts.offset],
    );
    return rows.map(rowToEvent);
  }

  async countByWebhook(webhookId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM jm_webhook_events WHERE webhook_id = $1`,
      [webhookId],
    );
    return rows[0]?.n ?? 0;
  }
```

- [ ] **Step 2: Verify it type-checks against the interface**

Run: `cd packages/orchestrator && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: No errors referencing `postgres-webhook-event-store.ts` (the class now satisfies the expanded `IWebhookEventStore`). A full repo typecheck runs in Task 6.

---

### Task 3: Add the API route

**Files:**
- Modify: `packages/api-server/src/routes/webhooks-management.ts`

- [ ] **Step 1: Register the paginated events route**

In `packages/api-server/src/routes/webhooks-management.ts`, inside `registerWebhookManagementRoutes`, add this route immediately after the `GET /api/webhooks/:id` handler (around line 109). It reuses the existing `load()` helper for ownership/auth and mirrors the paging clamp used by the `/workflow-instances` route:

```ts
  app.get("/api/webhooks/:id/events",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const r = await load(req, id);
      if ("error" in r) return reply.code(r.code).send({ error: r.error });

      const q = req.query as { page?: string; page_size?: string };
      const page = Math.max(1, Number(q.page ?? 1) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(q.page_size ?? 25) || 25));
      const offset = (page - 1) * pageSize;

      const [events, total] = await Promise.all([
        c.webhookEvents.listByWebhook(id, { limit: pageSize, offset }),
        c.webhookEvents.countByWebhook(id),
      ]);
      return { events, total, page, pageSize };
    });
```

- [ ] **Step 2: Confirm `c.webhookEvents` is on the Composition**

Run: `grep -n "webhookEvents" packages/api-server/src/composition.ts`
Expected: a line exposing `webhookEvents` (the store is already used by `webhook-ingest.ts`). If present, no change needed.

---

### Task 4: Typed client

**Files:**
- Modify: `packages/web/src/api/webhooks.ts`

- [ ] **Step 1: Replace the stub with a real paged client**

In `packages/web/src/api/webhooks.ts`, delete the `listRecentEventsForWebhook` stub (lines ~100-104 and its comment) and add:

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

`WebhookEvent` is already imported at the top of the file.

---

### Task 5: Rewrite the table UI

**Files:**
- Modify: `packages/web/src/routes/webhooks/WebhookEventsTab.tsx`

- [ ] **Step 1: Replace the whole component**

Replace the entire contents of `packages/web/src/routes/webhooks/WebhookEventsTab.tsx` with:

```tsx
import { Fragment, useEffect, useState } from "react";
import type { WebhookEvent, WebhookEventStatus } from "@journeyman/core";
import { listWebhookEvents } from "../../api/webhooks.ts";

const PAGE_SIZE = 25;

const STATUS_COLORS: Record<WebhookEventStatus, string> = {
  received: "bg-slate-700 text-slate-200",
  processed: "bg-emerald-900 text-emerald-200",
  ignored: "bg-slate-800 text-slate-400",
  error: "bg-red-900 text-red-200",
  auth_failed: "bg-red-900 text-red-200",
  schema_invalid: "bg-amber-900 text-amber-200",
};

function StatusBadge({ status }: { status: WebhookEventStatus }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_COLORS[status] ?? "bg-slate-700 text-slate-200"}`}>
      {status}
    </span>
  );
}

export function WebhookEventsTab({ webhookId }: { webhookId: string }) {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listWebhookEvents(webhookId, { page, pageSize: PAGE_SIZE })
      .then((r) => {
        if (cancelled) return;
        setEvents(r.events);
        setTotal(r.total);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [webhookId, page, reloadKey]);

  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const hasPrev = page > 1;
  const hasNext = page * PAGE_SIZE < total;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {total === 0 ? "No events" : `Showing ${from}–${to} of ${total}`}
        </span>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="text-xs text-slate-400 hover:text-slate-200 border border-slate-700 rounded px-2 py-1"
        >
          Refresh
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && !error && events.length === 0 && (
        <p className="text-sm text-slate-400">No events received yet.</p>
      )}

      {!loading && !error && events.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
              <th className="py-2 font-medium">Event type</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Delivery ID</th>
              <th className="py-2 font-medium">Received</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <Fragment key={ev.id}>
                <tr
                  onClick={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
                  className="border-b border-slate-800 cursor-pointer hover:bg-slate-800/50"
                >
                  <td className="py-2 text-slate-200">{ev.eventType ?? "(no type)"}</td>
                  <td className="py-2"><StatusBadge status={ev.status} /></td>
                  <td className="py-2 text-xs text-slate-500 font-mono">{ev.deliveryId ?? "—"}</td>
                  <td className="py-2 text-xs text-slate-500">{new Date(ev.receivedAt).toLocaleString()}</td>
                </tr>
                {expandedId === ev.id && (
                  <tr className="border-b border-slate-800 bg-slate-900/60">
                    <td colSpan={4} className="py-3 px-2 space-y-3">
                      {ev.error && <p className="text-xs text-red-400">error: {ev.error}</p>}
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Payload</div>
                        <pre className="text-xs text-slate-300 overflow-x-auto bg-slate-950 rounded p-2">
                          {JSON.stringify(ev.rawPayload, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Headers</div>
                        <pre className="text-xs text-slate-300 overflow-x-auto bg-slate-950 rounded p-2">
                          {JSON.stringify(ev.rawHeaders, null, 2)}
                        </pre>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {!loading && !error && total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            disabled={!hasPrev}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="text-xs border border-slate-700 rounded px-2 py-1 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
          >
            ← Prev
          </button>
          <button
            disabled={!hasNext}
            onClick={() => setPage((p) => p + 1)}
            className="text-xs border border-slate-700 rounded px-2 py-1 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify in the preview**

Start/refresh the web preview, open a webhook with received events → **Recent events** tab. Confirm: table renders newest-first; clicking a row reveals payload + headers JSON; Prev/Next disable correctly at the ends; Refresh re-fetches; a webhook with no events shows "No events received yet." Capture a screenshot as proof.

---

### Task 6: Final typecheck (per user instruction)

**Files:** none

- [ ] **Step 1: Run the repo typecheck**

Run: `npm run typecheck`
Expected: PASS with no errors. Fix any type errors surfaced in the touched files before considering the work complete.

- [ ] **Step 2: Run the affected unit tests**

Run: `cd packages/orchestrator && npx vitest run src/stores/memory/memory-webhook-event-store.test.ts`
Expected: PASS (3 tests).
