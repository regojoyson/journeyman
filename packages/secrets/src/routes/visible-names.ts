import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { listVisibleSecrets } from "../visibility.ts";

export async function registerVisibleNamesRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/orgs/:orgId/secrets/_visible-names",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const ctx = req.runContext!;
      const { orgId } = req.params as { orgId: string };
      if (ctx.org.id !== orgId) {
        reply.code(403);
        return { error: "wrong_org" };
      }
      const scoped = await listVisibleSecrets(pool, ctx);
      return {
        names: [...new Set(scoped.map(s => s.name))].sort(),
        scoped,
      };
    },
  );
}
