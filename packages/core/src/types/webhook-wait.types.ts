import type { JsonLogicExpr } from "./flow-condition.types.ts";
import type { WebhookProvider } from "./webhook.types.ts";

export interface WebhookWaitOutputField {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "date";
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  /** Dot-path into the webhook payload to extract this field's value. */
  fromPath?: string;
}

export interface WebhookWaitConfig {
  /** Which provider's events this node listens to. */
  provider: WebhookProvider;
  /** Event-type allowlist; empty/undefined means accept any event type. */
  listensFor?: string[];
  /** JSONLogic predicate evaluated against the raw payload; must be truthy to match. */
  acceptIf?: JsonLogicExpr;
  /**
   * How this paused node binds to an incoming event. V1 only supports
   * `"issueRef"` — the matcher uses the workflow instance's `issueRef` and
   * compares against the event's extracted ref.
   */
  correlationKey?: "issueRef";
  outputs: WebhookWaitOutputField[];
  timeout?: {
    duration: string;
    defaults?: Record<string, unknown>;
  };
}

export const WEBHOOK_WAIT_RESERVED_KEYS = ["source", "resolvedAt", "webhookEventId", "payload"] as const;
export type WebhookWaitReservedKey = typeof WEBHOOK_WAIT_RESERVED_KEYS[number];

export type WebhookWaitSource = "webhook" | "timeout";

export type WebhookWaitOutput = {
  source: WebhookWaitSource;
  resolvedAt: string;
  webhookEventId: string | null;
  payload: Record<string, unknown>;
} & Record<string, unknown>;
