import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { listVisibleCustomAiSteps } from "../db.ts";

export async function registerVisibleCustomStepRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/orgs/:orgId/custom-steps/visible",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listVisibleCustomAiSteps(pool, orgId, ctx.user.id);
    },
  );
}
