import type { FastifyInstance } from "fastify";
import { listPresets } from "@journeyman/webhooks";
import { makeRequireAuth } from "@journeyman/identity";
import type { Composition } from "../composition.ts";

export function registerWebhookPresetRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });

  app.get("/api/webhook-presets", { preHandler: requireAuth() }, async () => {
    return listPresets().map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      icon: p.icon ?? null,
      docsUrl: p.docsUrl ?? null,
      auth: p.auth,
      eventTypePath: p.eventTypePath ?? null,
      deliveryIdHeader: p.deliveryIdHeader ?? null,
      knownEventTypes: p.knownEventTypes ?? [],
      correlationSuggestions: p.correlationSuggestions ?? [],
      hasSchema: p.payloadSchema != null,
      hasSamples: !!p.samples && Object.keys(p.samples).length > 0,
    }));
  });

  app.get("/api/webhook-presets/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const all = listPresets();
    const found = all.find((p) => p.id === id);
    if (!found) {
      reply.code(404);
      return { error: "not_found" };
    }
    return found;
  });
}
