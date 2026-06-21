import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Composition } from "@journeyman/api-context";
import { ingestForWebhook } from "../services/webhook-ingest.ts";

function rawBodyOf(req: FastifyRequest): Buffer {
  const body = req.body as unknown;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  return Buffer.from(JSON.stringify(body ?? {}), "utf8");
}

export function registerWebhookRoutes(app: FastifyInstance, c: Composition): void {
  // Universal ingest using the webhook registry. Each registered webhook
  // gets a unique tenantToken; lookup → verify → schema-check → match
  // happens inside ingestForWebhook.
  app.post("/webhooks/in/:tenantToken", async (req, reply) => {
    const { tenantToken } = req.params as { tenantToken: string };
    const webhook = await c.webhooks.getByTenantToken(tenantToken);
    if (!webhook) {
      reply.code(404);
      return { error: "unknown_webhook" };
    }

    const result = await ingestForWebhook(c, c.pool, {
      webhook,
      rawBody: rawBodyOf(req),
      rawPayload: req.body as unknown,
      headers: req.headers as Record<string, string | string[] | undefined>,
    });

    switch (result.status) {
      case "auth_failed":
        reply.code(401);
        return { error: "auth_failed", reason: result.reason };
      case "schema_invalid":
        reply.code(400);
        return { error: "schema_invalid", reason: result.reason, eventId: result.eventId };
      case "resolved":
        reply.code(200);
        return {
          status: "resolved",
          matched: result.matched,
          eventId: result.eventId,
          ...(result.triggers ? { triggers: result.triggers } : {}),
          ...(result.waits ? { waits: result.waits } : {}),
        };
      case "processed":
        reply.code(200);
        return { status: "processed", eventId: result.eventId };
      case "ignored":
        reply.code(200);
        return { status: "ignored", eventId: result.eventId };
      case "error":
        reply.code(200);
        return {
          status: "error",
          reason: result.reason,
          eventId: result.eventId,
          ...(result.triggers ? { triggers: result.triggers } : {}),
          ...(result.waits ? { waits: result.waits } : {}),
        };
    }
  });
}
