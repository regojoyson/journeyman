import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  deleteModelPricing, getModelPricing, insertModelPricing,
  listModelPricingByOrg, updateModelPricing,
} from "../pricing-db.ts";

export async function registerOrgModelPricingRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/orgs/:orgId/model-pricing",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listModelPricingByOrg(pool, orgId);
    },
  );

  app.post(
    "/api/orgs/:orgId/model-pricing",
    { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "model_pricing.create", targetType: "model_pricing" } } },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const b = req.body as any;
      if (!b?.provider || !b?.model) {
        return reply.code(400).send({ error: "provider, model required" });
      }
      const rec = await insertModelPricing(pool, orgId, {
        provider: String(b.provider), vendor: b.vendor, model: String(b.model),
        inputPer1m: b.inputPer1m, outputPer1m: b.outputPer1m, cacheReadPer1m: b.cacheReadPer1m,
        cacheCreationPer1m: b.cacheCreationPer1m, reasoningPer1m: b.reasoningPer1m,
        currency: b.currency, effectiveFrom: b.effectiveFrom,
      });
      req.auditTargetId = rec.id;
      reply.code(201);
      return rec;
    },
  );

  app.patch(
    "/api/orgs/:orgId/model-pricing/:id",
    { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "model_pricing.update", targetType: "model_pricing" } } },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const updated = await updateModelPricing(pool, orgId, id, req.body as any);
      if (!updated) return reply.code(404).send({ error: "Not found" });
      return updated;
    },
  );

  app.delete(
    "/api/orgs/:orgId/model-pricing/:id",
    { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "model_pricing.delete", targetType: "model_pricing" } } },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const ok = await deleteModelPricing(pool, orgId, id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      reply.code(204);
      return null;
    },
  );
}
