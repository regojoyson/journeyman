import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import { listVisibleSecrets } from "../visibility.ts";

export async function registerVisibleNamesRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });
  const requirePerm = makeRequireWorkspacePermission({ pool });

  app.get(
    "/api/workspaces/:wsId/secrets/_visible-names",
    { preHandler: [requireAuth(), requirePerm("resource.read")] },
    async (req) => {
      const ctx = req.runContext!;
      const scoped = await listVisibleSecrets(pool, ctx);
      return {
        names: [...new Set(scoped.map(s => s.name))].sort(),
        scoped,
      };
    },
  );
}
