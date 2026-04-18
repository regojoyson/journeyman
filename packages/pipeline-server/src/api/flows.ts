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
