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
