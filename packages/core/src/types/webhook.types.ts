export type WebhookEventStatus =
  | "received"
  | "processed"
  | "ignored"
  | "error"
  | "auth_failed"
  | "schema_invalid";

// Legacy provider union retained for backward compatibility with existing
// /webhooks/:provider routes and stored events.
export type WebhookProvider = "jira" | "github" | "monday" | "linear" | "api" | "manual";

export type PresetId =
  | "github"
  | "github-issues"
  | "github-projects"
  | "gitlab"
  | "gitlab-issues"
  | "bitbucket"
  | "bitbucket-issues"
  | "jira"
  | "linear"
  | "monday"
  | "generic";

export type WebhookKind = "ticket" | "git";

export type WebhookAuthConfig =
  | { mode: "none" }
  | { mode: "header-equals"; header: string; valueRef: string }
  | {
      mode: "hmac";
      algo: "sha256" | "sha1" | "sha512";
      encoding: "hex" | "base64";
      header: string;
      prefix?: string;
      secretRef: string;
      timestamp?: {
        header: string;
        toleranceSeconds: number;
        signedFormat: string; // e.g. "{timestamp}.{body}"
      };
    }
  | {
      mode: "jwt";
      algo: "HS256" | "RS256" | "ES256";
      header: string;
      stripPrefix?: string;
      signingKeyRef?: string;
      jwksUrl?: string;
      expectedIssuer?: string;
      expectedAudience?: string;
    };

export type WebhookCorrelationSuggestion = {
  key: string;
  path: string;
};

export type WebhookScope = { orgId: string } | { userId: string };

export type Webhook = {
  id: string;
  scope: WebhookScope;
  name: string;
  description?: string;
  preset: PresetId;
  kind: WebhookKind;

  tenantToken: string;
  ingestUrl: string;

  auth: WebhookAuthConfig;

  payloadSchema?: unknown; // JSON Schema document; opaque to consumers
  schemaValidation: "off" | "warn" | "reject";
  schemaInferredFrom?: string;

  eventTypePath?: string; // "header:x-github-event" | "$.webhookEvent"
  deliveryIdHeader?: string;

  correlationSuggestions?: WebhookCorrelationSuggestion[];

  createdAt: Date;
  updatedAt: Date;
  rotatedAt?: Date;
  lastEventAt?: Date;
};

export type WebhookEvent = {
  id: string;
  receivedAt: Date;
  /** FK to jm_webhooks; null for legacy events created before the registry. */
  webhookId: string | null;
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
