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
      webhookId: args.webhookId ?? null,
      provider: args.provider,
      eventType: args.eventType ?? null,
      deliveryId: args.deliveryId ?? null,
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
}
