import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { listEnabledCodingModelsByProvider } from "../db.ts";

export async function registerPublicCodingModelRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/coding-models",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const provider = (req.query as { provider?: string }).provider;
      if (!provider || typeof provider !== "string") {
        return reply.code(400).send({ error: "provider query param required" });
      }
      const orgId = req.runContext?.org.id;
      if (!orgId) return reply.code(400).send({ error: "org context required" });
      return listEnabledCodingModelsByProvider(pool, orgId, provider);
    },
  );
}
