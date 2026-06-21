import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import { getLiveStats } from "../db/live.ts";
import { getOverviewStats } from "../db/overview.ts";
import { parseWindow } from "../window.ts";
import { registerUsageRoutes } from "./usage.ts";

export async function registerAnalyticsRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });
  const requirePerm = makeRequireWorkspacePermission({ pool });

  app.get(
    "/api/analytics/workspaces/:wsId/live",
    { preHandler: [requireAuth(), requirePerm("resource.read")] },
    async (req) => {
      const { wsId } = req.params as { wsId: string };
      return await getLiveStats(pool, wsId);
    },
  );

  app.get(
    "/api/analytics/workspaces/:wsId/overview",
    { preHandler: [requireAuth(), requirePerm("resource.read")] },
    async (req) => {
      const { wsId } = req.params as { wsId: string };
      const { window } = req.query as { window?: string };
      return await getOverviewStats(pool, wsId, parseWindow(window));
    },
  );

  registerUsageRoutes(app, pool);
}
