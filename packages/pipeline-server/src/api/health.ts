/**
 * @file health.ts
 * GET /api/health — liveness check and registry summary.
 *
 * Returns `{ status: "ok", registries: { phases, flows, coding, git, ticket, notification } }`
 * with the count of registered items in each category. Useful for deployment health checks
 * and confirming that all phases and providers loaded correctly at boot.
 * No auth required (excluded from the bearer-token middleware).
 */

import type { FastifyInstance } from "fastify";
import type { IFlowConfigSource, IProviderMeta } from "@journeyman/core";

export type HealthApiDeps = {
  phases: { list(): string[] };
  providers: { listByCategory(c: IProviderMeta["category"]): IProviderMeta[] };
  flows: IFlowConfigSource;
};

export function registerHealth(app: FastifyInstance, deps: HealthApiDeps) {
  app.get("/api/health", async () => {
    const flows = await deps.flows.listFlows();
    return {
      status: "ok",
      registries: {
        phases: deps.phases.list().length,
        flows: flows.length,
        coding: deps.providers.listByCategory("coding-cli").length,
        git: deps.providers.listByCategory("git").length,
        ticket: deps.providers.listByCategory("ticket").length,
        notification: deps.providers.listByCategory("notification").length,
      },
    };
  });
}
