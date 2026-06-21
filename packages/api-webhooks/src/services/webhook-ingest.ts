import type { Pool } from "pg";
import type { Webhook, WebhookEvent, WebhookProvider } from "@journeyman/core";
import {
  extractEventType,
  validatePayload,
  verifyWebhookRequest,
  type VerifyInput,
} from "@journeyman/webhooks";
import type { Composition } from "@journeyman/api-context";
import { matchAndResolveWebhookWaits, type WaitOutcome } from "@journeyman/api-context";
import { resolveWebhookSecret, secretRefFromAuth } from "./webhook-secret-lookup.ts";
import { fireWebhookTriggers, type TriggerOutcome } from "./webhook-trigger-fire.ts";
import { fireAgentForWebhook } from "./agent-webhook-fire.ts";

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
  | { status: "resolved"; matched: number; eventId: string; triggers?: TriggerOutcome[]; waits?: WaitOutcome[] }
  | { status: "processed"; eventId: string }
  | { status: "ignored"; eventId: string }
  | { status: "auth_failed"; reason: string }
  | { status: "schema_invalid"; eventId: string; reason: string }
  | { status: "error"; eventId: string; reason: string; triggers?: TriggerOutcome[]; waits?: WaitOutcome[] };

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
    resolvedSecret = await resolveWebhookSecret(pool, webhook.orgId, secretRef, webhook.workspaceId);
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

  // 5. Match against paused webhook-wait nodes. Each wait is isolated, so the
  //    result carries per-instance outcomes (resolved AND failed) rather than a
  //    single pass/fail.
  try {
    const waitResult = await matchAndResolveWebhookWaits(c, {
      id: event.id,
      provider: webhook.preset,
      eventType,
      rawPayload: input.rawPayload,
    });
    // Resume-wins: if any correlated wait was attempted (resolved or errored),
    // the event belongs to the wait path — do not also fire start-of-flow triggers.
    if (waitResult.matched > 0 || waitResult.failed > 0) {
      void c.webhooks.touchLastEvent(webhook.id);
      if (waitResult.matched > 0) {
        await c.webhookEvents.setStatus(event.id, "processed");
        return { status: "resolved", matched: waitResult.matched, eventId: event.id, waits: waitResult.outcomes };
      }
      const reason = waitResult.outcomes.find((o) => !o.ok)?.error ?? "webhook wait resolution failed";
      await c.webhookEvents.setStatus(event.id, "error", reason);
      return { status: "error", eventId: event.id, reason, waits: waitResult.outcomes };
    }

    // 6b. No waiters → an agent may own this webhook (Phase 3b). If so, it handles
    //     the event (filter + map + run); otherwise fall through to workflow triggers.
    const ar = await fireAgentForWebhook(c, { webhookId: webhook.id, rawPayload: input.rawPayload, eventType });
    if (ar.fired > 0) {
      void c.webhooks.touchLastEvent(webhook.id);
      await c.webhookEvents.setStatus(event.id, "processed");
      return { status: "resolved", matched: ar.fired, eventId: event.id };
    }
    if (ar.skipped === "filtered") {
      await c.webhookEvents.setStatus(event.id, "ignored");
      void c.webhooks.touchLastEvent(webhook.id);
      return { status: "ignored", eventId: event.id };
    }

    // 7. No waiters → try start-of-flow triggers. Each trigger is isolated, so a
    //    single failing workflow no longer discards its siblings' outcomes.
    const tr = await fireWebhookTriggers(c, {
      webhook,
      eventId: event.id,
      eventType,
      rawPayload: input.rawPayload,
    });
    if (tr.fired > 0 || tr.failed > 0) {
      void c.webhooks.touchLastEvent(webhook.id);
      if (tr.fired > 0) {
        // At least one workflow started → the event was handled. Any per-trigger
        // failures are still reported in `triggers` for visibility.
        await c.webhookEvents.setStatus(event.id, "processed");
        return { status: "resolved", matched: tr.fired, eventId: event.id, triggers: tr.outcomes };
      }
      // Every matching trigger failed to start.
      const reason = tr.outcomes.find((o) => !o.ok)?.error ?? "trigger failed";
      await c.webhookEvents.setStatus(event.id, "error", reason);
      return { status: "error", eventId: event.id, reason, triggers: tr.outcomes };
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
