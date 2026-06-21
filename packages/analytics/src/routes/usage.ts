import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import type { UsageDimensionKey } from "@journeyman/core";
import { parseWindow, windowSince } from "../window.ts";
import {
  usageSummary, usageTimeseries, usageByDimension, usageWaste, usageInstance, DIMENSION_SQL,
} from "../db/usage.ts";

export function registerUsageRoutes(app: FastifyInstance, pool: Pool): void {
  const requireAuth = makeRequireAuth({ pool });
  const requirePerm = makeRequireWorkspacePermission({ pool });
  const read = { preHandler: [requireAuth(), requirePerm("resource.read")] };
  const base = "/api/analytics/workspaces/:wsId/usage";

  app.get(`${base}/summary`, read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    const window = parseWindow((req.query as { window?: string }).window);
    const now = new Date();
    return usageSummary(pool, wsId, windowSince(window, now), now);
  });

  app.get(`${base}/timeseries`, read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    const window = parseWindow((req.query as { window?: string }).window);
    return usageTimeseries(pool, wsId, windowSince(window, new Date()));
  });

  app.get(`${base}/by/:dimension`, read, async (req, reply) => {
    const { wsId, dimension } = req.params as { wsId: string; dimension: string };
    if (!(dimension in DIMENSION_SQL)) {
      return reply.code(400).send({ error: `unknown dimension '${dimension}'` });
    }
    const window = parseWindow((req.query as { window?: string }).window);
    return usageByDimension(pool, wsId, windowSince(window, new Date()), dimension as UsageDimensionKey);
  });

  app.get(`${base}/waste`, read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    const window = parseWindow((req.query as { window?: string }).window);
    return usageWaste(pool, wsId, windowSince(window, new Date()));
  });

  app.get(`${base}/instances/:instanceId`, read, async (req) => {
    const { wsId, instanceId } = req.params as { wsId: string; instanceId: string };
    return usageInstance(pool, wsId, instanceId);
  });
}
