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
