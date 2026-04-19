/**
 * @file flows.ts
 * GET /api/flows — list all registered flows with their provider ids and step ids.
 *
 * Returns an array of `{ name, providers, steps: string[] }` — one entry per flow.
 * Step ids are returned in declaration order. Full step config is omitted; use this
 * endpoint for discovery and to verify flow registration after deploy.
 */

import type { FastifyInstance } from "fastify";
import type { IFlowConfigSource } from "@journeyman/core";

export type FlowsApiDeps = { flows: IFlowConfigSource };

export function registerFlowsApi(app: FastifyInstance, deps: FlowsApiDeps) {
  app.get("/api/flows", async () => {
    const names = await deps.flows.listFlows();
    return Promise.all(names.map(async n => {
      const f = await deps.flows.getFlow(n);
      return { name: f.name, providers: f.providers, steps: f.steps.map(s => s.id) };
    }));
  });
}
