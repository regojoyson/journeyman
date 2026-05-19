import type { CreateWebhookEventArgs, WebhookEvent, WebhookEventStatus } from "../types/webhook.types.ts";

export interface IWebhookEventStore {
  create(args: CreateWebhookEventArgs): Promise<WebhookEvent>;
  setStatus(id: string, status: WebhookEventStatus, error?: string): Promise<void>;
  getById(id: string): Promise<WebhookEvent | null>;
  listByIssueRef(issueRef: string): Promise<WebhookEvent[]>;
}
