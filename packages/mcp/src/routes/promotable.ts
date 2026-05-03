import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { listPromotable } from "../db.ts";

export async function registerPromotableMcpRoute(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/orgs/:orgId/mcp-instances/promotable",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listPromotable(pool, orgId);
    },
  );
}
