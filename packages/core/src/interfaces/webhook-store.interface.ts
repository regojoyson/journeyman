import type {
  Webhook,
  WebhookAuthConfig,
  WebhookCorrelationSuggestion,
  WebhookKind,
  WebhookScope,
  PresetId,
} from "../types/webhook.types.ts";

export type CreateWebhookArgs = {
  scope: WebhookScope;
  name: string;
  description?: string;
  preset: PresetId;
  kind: WebhookKind;
  auth: WebhookAuthConfig;
  payloadSchema?: unknown;
  schemaValidation?: "off" | "warn" | "reject";
  schemaInferredFrom?: string;
  eventTypePath?: string;
  deliveryIdHeader?: string;
  correlationSuggestions?: WebhookCorrelationSuggestion[];
};

export type UpdateWebhookArgs = {
  name?: string;
  description?: string | null;
  auth?: WebhookAuthConfig;
  payloadSchema?: unknown | null;
  schemaValidation?: "off" | "warn" | "reject";
  schemaInferredFrom?: string | null;
  eventTypePath?: string | null;
  deliveryIdHeader?: string | null;
  correlationSuggestions?: WebhookCorrelationSuggestion[] | null;
};

export interface IWebhookStore {
  /** Create a new webhook. Caller supplies the freshly-minted tenantToken. */
  create(args: CreateWebhookArgs, tenantToken: string): Promise<Webhook>;

  /** Look up by primary key. */
  getById(id: string): Promise<Webhook | null>;

  /** Look up by the opaque token that appears in the ingest URL. Hot path. */
  getByTenantToken(token: string): Promise<Webhook | null>;

  /** All webhooks owned by a scope, ordered by createdAt asc. */
  listByScope(scope: WebhookScope): Promise<Webhook[]>;

  /** Partial update. Returns null if no such id. */
  update(id: string, patch: UpdateWebhookArgs): Promise<Webhook | null>;

  /** Replace tenantToken (caller mints the new one). Updates rotatedAt. */
  rotateToken(id: string, newTenantToken: string): Promise<Webhook | null>;

  /** Bumps lastEventAt to now. Fire-and-forget; do not block ingest on this. */
  touchLastEvent(id: string): Promise<void>;

  /** Returns true if a row was deleted. */
  delete(id: string): Promise<boolean>;
}
