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
}
