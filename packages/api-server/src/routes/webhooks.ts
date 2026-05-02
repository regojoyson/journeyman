import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import type { WebhookProvider } from "@journeyman/core";

const DELIVERY_HEADERS: Record<string, string> = {
  github: "x-github-delivery",
  jira: "x-atlassian-webhook-identifier",
};

const BLOCKED_HEADERS = new Set(["authorization", "x-hub-signature", "x-hub-signature-256", "cookie"]);

function sanitiseHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!BLOCKED_HEADERS.has(k.toLowerCase())) {
      out[k] = Array.isArray(v) ? v.join(", ") : (v ?? "");
    }
  }
  return out;
}

const VALID_PROVIDERS = new Set<WebhookProvider>(["jira", "github", "monday", "linear"]);

export function registerWebhookRoutes(app: FastifyInstance, c: Composition): void {
  app.post("/webhooks/:provider", async (req, reply) => {
    const { provider } = req.params as { provider: string };

    if (!VALID_PROVIDERS.has(provider as WebhookProvider)) {
      reply.code(404);
      return { error: "unknown_provider" };
    }

    const rawPayload = req.body as unknown;
    const rawHeaders = sanitiseHeaders(req.headers as Record<string, string | string[] | undefined>);
    const deliveryHeaderKey = DELIVERY_HEADERS[provider] ?? "";
    const deliveryId = (req.headers[deliveryHeaderKey] as string | undefined) ?? null;

    const event = await c.webhookEvents.create({
      provider: provider as WebhookProvider,
      eventType: null,
      deliveryId,
      issueRef: null,
      productId: null,
      rawHeaders,
      rawPayload,
    });

    try {
      const payload = rawPayload as Record<string, unknown>;
      let issueRef: string | null = null;
      let eventType: string | null = null;

      if (provider === "jira") {
        const key = (payload?.issue as any)?.key as string | undefined;
        if (key) issueRef = `jira:${key}`;
        eventType = (payload?.webhookEvent as string) ?? null;
      } else if (provider === "github") {
        const number = (payload?.issue as any)?.number;
        const repo = (payload?.repository as any)?.full_name as string | undefined;
        if (number != null && repo) issueRef = `github:${repo}#${number}`;
        eventType = (req.headers["x-github-event"] as string) ?? null;
      } else if (provider === "monday") {
        const itemId = (payload?.event as any)?.pulseId as number | undefined;
        if (itemId != null) issueRef = `monday:${itemId}`;
        eventType = (payload?.event as any)?.type as string ?? null;
      } else if (provider === "linear") {
        const identifier = (payload?.data as any)?.identifier as string | undefined;
        if (identifier) issueRef = `linear:${identifier}`;
        eventType = (payload?.action as string) ?? null;
      }

      if (c.pool) {
        await c.pool.query(
          "UPDATE jm_webhook_events SET issue_ref = $1, event_type = $2 WHERE id = $3",
          [issueRef, eventType, event.id],
        );
      }

      // Flow resolution stub — replace with real resolver when available
      const matchingFlows: string[] = [];

      if (matchingFlows.length === 0) {
        await c.webhookEvents.setStatus(event.id, "ignored");
        reply.code(200);
        return { status: "ignored" };
      }

      for (const flowId of matchingFlows) {
        await c.runs.create({
          flowId,
          flowVersionId: null,
          flowNameSnapshot: flowId,
          flowScopeSnapshot: "org",
          definitionSnapshot: {} as any,
          triggerSource: "webhook",
          startedByUserId: null,
          startedByOrgId: null,
          inputs: { issueRef, eventType },
          webhookEventId: event.id,
        });
      }

      await c.webhookEvents.setStatus(event.id, "processed");
      reply.code(200);
      return { status: "processed" };

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("jm_webhook_events_delivery_idx")) {
        await c.webhookEvents.setStatus(event.id, "ignored");
        reply.code(200);
        return { status: "ignored" };
      }
      await c.webhookEvents.setStatus(event.id, "error", message);
      reply.code(200);
      return { status: "error" };
    }
  });
}
