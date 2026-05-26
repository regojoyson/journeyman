import type { WorkflowInputValue } from "./flow.types.ts";
import type { JsonLogicExpr } from "./flow-condition.types.ts";

/**
 * How a paused webhook-wait correlates to an incoming event.
 *
 * - `eventPath`: JSONPath into the inbound event payload (e.g. "$.pull_request.number").
 * - `value`: a WorkflowInputValue (literal | ref | template) resolved against
 *   the workflow instance's state at pause time. The resolved string is
 *   snapshotted onto `jm_node_executions.correlation_value`.
 */
export interface CorrelationKey {
  eventPath: string;
  value: WorkflowInputValue;
}

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
  /** Registered webhook this node listens to. Required at publish time. */
  webhookId: string;
  /** Event-type allowlist; empty/undefined means accept any event type. */
  listensFor?: string[];
  /** JSONLogic predicate evaluated against the raw payload; must be truthy to match. */
  acceptIf?: JsonLogicExpr;
  /** Required at publish time. Determines which paused wait an incoming event resumes. */
  correlationKey?: CorrelationKey;
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
