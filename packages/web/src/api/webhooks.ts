import type {
  CreateWebhookArgs,
  PresetId,
  UpdateWebhookArgs,
  Webhook,
  WebhookEvent,
} from "@journeyman/core";
import { api } from "./client.ts";

export interface WebhookPresetSummary {
  id: PresetId;
  name: string;
  kind: "ticket" | "git";
  icon: string | null;
  docsUrl: string | null;
  auth: Webhook["auth"];
  eventTypePath: string | null;
  deliveryIdHeader: string | null;
  knownEventTypes: string[];
  hasSchema: boolean;
  hasSamples: boolean;
}

export interface WebhookPresetDetail extends WebhookPresetSummary {
  payloadSchema?: unknown;
  samples?: Record<string, unknown>;
}

export function listOrgWebhooks(orgId: string): Promise<Webhook[]> {
  return api<Webhook[]>(`/api/orgs/${encodeURIComponent(orgId)}/webhooks`);
}

export function listMyWebhooks(): Promise<Webhook[]> {
  return api<Webhook[]>(`/api/users/me/webhooks`);
}

export function createOrgWebhook(orgId: string, body: Omit<CreateWebhookArgs, "scope">): Promise<Webhook> {
  return api<Webhook>(`/api/orgs/${encodeURIComponent(orgId)}/webhooks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createMyWebhook(body: Omit<CreateWebhookArgs, "scope">): Promise<Webhook> {
  return api<Webhook>(`/api/users/me/webhooks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getWebhook(id: string): Promise<Webhook> {
  return api<Webhook>(`/api/webhooks/${encodeURIComponent(id)}`);
}

export function updateWebhook(id: string, patch: UpdateWebhookArgs): Promise<Webhook> {
  return api<Webhook>(`/api/webhooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteWebhook(id: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/api/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function rotateWebhook(id: string): Promise<Webhook> {
  return api<Webhook>(`/api/webhooks/${encodeURIComponent(id)}/rotate`, {
    method: "POST",
    body: "{}",
  });
}

export function promoteWebhookToOrg(orgId: string, webhookId: string): Promise<Webhook> {
  return api<Webhook>(
    `/api/orgs/${encodeURIComponent(orgId)}/webhooks/${encodeURIComponent(webhookId)}/promote-from-user`,
    { method: "POST", body: "{}" },
  );
}

export interface TestDeliveryResult {
  ingestStatus: number;
  ingestBody: unknown;
}

export function testWebhook(id: string, body: { sampleEvent?: string; payload?: unknown }): Promise<TestDeliveryResult> {
  return api<TestDeliveryResult>(`/api/webhooks/${encodeURIComponent(id)}/test`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listPresets(): Promise<WebhookPresetSummary[]> {
  return api<WebhookPresetSummary[]>(`/api/webhook-presets`);
}

export function getPresetDetail(id: PresetId): Promise<WebhookPresetDetail> {
  return api<WebhookPresetDetail>(`/api/webhook-presets/${encodeURIComponent(id)}`);
}

// Recent events for a webhook. Backend doesn't expose a dedicated endpoint yet;
// for v1 the UI shows an empty state. Wiring a real endpoint is a follow-up.
export async function listRecentEventsForWebhook(_webhookId: string): Promise<WebhookEvent[]> {
  return [];
}
