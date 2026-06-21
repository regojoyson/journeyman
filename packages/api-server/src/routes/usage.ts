import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import {
  buildUsageAggregateQuery, buildUsageTotalsQuery, DIMENSION_COLUMNS,
  type UsageDimension, type UsageFilters,
} from "@journeyman/orchestrator";

export function registerUsageRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });
  const requirePerm = makeRequireWorkspacePermission({ pool: c.pool! });
  const read = { preHandler: [requireAuth(), requirePerm("resource.read")] };

  const filtersFrom = (wsId: string, q: Record<string, string | undefined>): UsageFilters => ({
    wsId, from: q.from, to: q.to, provider: q.provider, vendor: q.vendor, model: q.model,
    agentId: q.agentId, workflowId: q.workflowId, instanceId: q.instanceId, outcome: q.outcome,
  });

  app.get("/workspaces/:wsId/usage", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    const { sql, params } = buildUsageTotalsQuery(filtersFrom(wsId, req.query as Record<string, string | undefined>));
    const { rows } = await c.pool!.query(sql, params);
    return rows[0];
  });

  app.get("/workspaces/:wsId/usage/by/:dimension", read, async (req, reply) => {
    const { wsId, dimension } = req.params as { wsId: string; dimension: string };
    if (!(dimension in DIMENSION_COLUMNS)) {
      return reply.code(400).send({ error: `unknown dimension '${dimension}'` });
    }
    const { sql, params } = buildUsageAggregateQuery(
      dimension as UsageDimension,
      filtersFrom(wsId, req.query as Record<string, string | undefined>),
    );
    const { rows } = await c.pool!.query(sql, params);
    return { dimension, groups: rows };
  });
}
