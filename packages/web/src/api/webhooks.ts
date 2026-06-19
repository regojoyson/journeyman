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

export function listWebhooks(wsId: string): Promise<Webhook[]> {
  return api<Webhook[]>(`/api/workspaces/${encodeURIComponent(wsId)}/webhooks`);
}

export function createWebhook(wsId: string, body: Omit<CreateWebhookArgs, "workspaceId" | "orgId">): Promise<Webhook> {
  return api<Webhook>(`/api/workspaces/${encodeURIComponent(wsId)}/webhooks`, {
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

export interface TestDeliveryResult {
  ingestStatus: number;
  ingestBody: unknown;
}

export function testWebhook(id: string, body: { sampleEvent?: string; payload?: unknown; eventType?: string }): Promise<TestDeliveryResult> {
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

export interface PagedWebhookEvents {
  events: WebhookEvent[];
  total: number;
  page: number;
  pageSize: number;
}

export function listWebhookEvents(
  webhookId: string,
  args: { page: number; pageSize: number },
): Promise<PagedWebhookEvents> {
  const qs = new URLSearchParams();
  qs.set("page", String(args.page));
  qs.set("page_size", String(args.pageSize));
  return api<PagedWebhookEvents>(`/api/webhooks/${encodeURIComponent(webhookId)}/events?${qs}`);
}
