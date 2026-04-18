import type { FastifyInstance } from "fastify";
import type { IStateStore } from "@journeyman/core";

export type RunsApiDeps = { state: IStateStore };

export function registerRunsApi(app: FastifyInstance, deps: RunsApiDeps) {
  app.get<{ Params: { sessionId: string } }>("/api/runs/:sessionId", async (req, reply) => {
    const run = await deps.state.load(req.params.sessionId);
    if (!run) return reply.code(404).send({ error: "not found" });
    return run;
  });

  app.get<{ Querystring: { product?: string; ticket?: string; status?: string; limit?: string } }>(
    "/api/runs",
    async (req) => {
      const { product, ticket, status, limit } = req.query;
      const lim = limit ? parseInt(limit, 10) : undefined;
      const runs = ticket
        ? await deps.state.findByTicket(product ?? "*", ticket)
        : await deps.state.find({ productId: product, status: status as any, limit: lim });
      return { runs };
    },
  );
}
