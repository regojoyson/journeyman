import type { Pool } from "pg";
import type { Webhook, WebhookEvent, WebhookProvider } from "@journeyman/core";
import {
  extractEventType,
  validatePayload,
  verifyWebhookRequest,
  type VerifyInput,
} from "@journeyman/webhooks";
import type { Composition } from "../composition.ts";
import { matchAndResolveWebhookWaits } from "./match-human-tasks.ts";
import { resolveWebhookSecret, secretRefFromAuth } from "./webhook-secret-lookup.ts";
import { fireWebhookTriggers } from "./webhook-trigger-fire.ts";

const BLOCKED_HEADERS = new Set([
  "authorization", "cookie",
  "x-hub-signature", "x-hub-signature-256",
  "linear-signature", "x-gitlab-token",
]);

function sanitiseHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (BLOCKED_HEADERS.has(k.toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : (v ?? "");
  }
  return out;
}

function lowercaseHeaderMap(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : (v ?? "");
  }
  return out;
}

function isLegacyProvider(preset: string): preset is WebhookProvider {
  return preset === "jira" || preset === "github" || preset === "monday" || preset === "linear";
}

export type IngestResult =
  | { status: "resolved"; matched: number; eventId: string }
  | { status: "processed"; eventId: string }
  | { status: "ignored"; eventId: string }
  | { status: "auth_failed"; reason: string }
  | { status: "schema_invalid"; eventId: string; reason: string }
  | { status: "error"; eventId: string; reason: string };

export type IngestInput = {
  webhook: Webhook;
  rawBody: Buffer;
  rawPayload: unknown;
  headers: Record<string, string | string[] | undefined>;
};

/**
 * The full ingest pipeline for a resolved webhook. The caller is responsible
 * for locating `webhook` (by tenantToken or legacy provider lookup).
 */
export async function ingestForWebhook(
  c: Composition,
  pool: Pool | null,
  input: IngestInput,
): Promise<IngestResult> {
  const { webhook } = input;
  const lcHeaders = lowercaseHeaderMap(input.headers);

  // 1. Verify auth.
  const verifyInput: VerifyInput = { headers: lcHeaders, rawBody: input.rawBody };
  let resolvedSecret: string | null = null;
  if (pool) {
    const secretRef = secretRefFromAuth(webhook.auth);
    resolvedSecret = await resolveWebhookSecret(pool, webhook.scope, secretRef);
  }
  const verifyResult = await verifyWebhookRequest(verifyInput, webhook.auth, resolvedSecret);
  if (!verifyResult.ok) {
    return { status: "auth_failed", reason: verifyResult.reason };
  }

  // 2. Resolve event type + delivery id.
  const eventType = extractEventType(webhook.eventTypePath, {
    headers: lcHeaders,
    payload: input.rawPayload,
  });
  const deliveryId = webhook.deliveryIdHeader
    ? (lcHeaders[webhook.deliveryIdHeader.toLowerCase()] ?? null)
    : null;

  // 3. Persist the event row up front so we always have an id to set status on.
  const sanitized = sanitiseHeaders(input.headers);
  const providerForLegacy: WebhookProvider = isLegacyProvider(webhook.preset)
    ? webhook.preset
    : "api";
  let event: WebhookEvent;
  try {
    event = await c.webhookEvents.create({
      webhookId: webhook.id,
      provider: providerForLegacy,
      eventType,
      deliveryId,
      productId: null,
      rawHeaders: sanitized,
      rawPayload: input.rawPayload,
    });
  } catch (err) {
    // Delivery-id unique violation → dedup hit.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("jm_webhook_events_delivery_idx")) {
      return { status: "ignored", eventId: "(duplicate)" };
    }
    throw err;
  }

  // 4. Schema validation (if configured to reject).
  if (webhook.payloadSchema && webhook.schemaValidation === "reject") {
    const v = validatePayload(webhook.payloadSchema, input.rawPayload);
    if (!v.ok) {
      const reason = v.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
      await c.webhookEvents.setStatus(event.id, "schema_invalid", reason);
      return { status: "schema_invalid", eventId: event.id, reason };
    }
  }

  // 5. Match against paused webhook-wait nodes.
  try {
    const result = await matchAndResolveWebhookWaits(c, {
      id: event.id,
      provider: webhook.preset,
      eventType,
      rawPayload: input.rawPayload,
    });
    if (result.matched > 0) {
      await c.webhookEvents.setStatus(event.id, "processed");
      void c.webhooks.touchLastEvent(webhook.id);
      return { status: "resolved", matched: result.matched, eventId: event.id };
    }

    // 7. No waiters → try start-of-flow triggers (resume-wins precedence).
    const tr = await fireWebhookTriggers(c, {
      webhook,
      eventId: event.id,
      eventType,
      rawPayload: input.rawPayload,
    });
    if (tr.fired > 0) {
      await c.webhookEvents.setStatus(event.id, "processed");
      void c.webhooks.touchLastEvent(webhook.id);
      return { status: "resolved", matched: tr.fired, eventId: event.id };
    }

    // 8. Nothing matched → mark ignored.
    await c.webhookEvents.setStatus(event.id, "ignored");
    void c.webhooks.touchLastEvent(webhook.id);
    return { status: "ignored", eventId: event.id };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await c.webhookEvents.setStatus(event.id, "error", reason);
    return { status: "error", eventId: event.id, reason };
  }
}
