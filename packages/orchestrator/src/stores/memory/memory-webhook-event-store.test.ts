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
