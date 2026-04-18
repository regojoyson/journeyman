import type { FastifyInstance } from "fastify";
import type { IStateStore } from "@journeyman/core";

export type PipelineLike = {
  cancel(sessionId: string): void;
};

export type CancelApiDeps = { pipeline: PipelineLike; state: IStateStore };

export function registerCancelApi(app: FastifyInstance, deps: CancelApiDeps) {
  app.post<{ Params: { sessionId: string } }>(
    "/api/runs/:sessionId/cancel",
    async (req, reply) => {
      deps.pipeline.cancel(req.params.sessionId);
      const run = await deps.state.load(req.params.sessionId);
      return reply.send(run ?? { sessionId: req.params.sessionId, status: "unknown" });
    },
  );
}
