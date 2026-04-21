/**
 * @file retry.ts
 * POST /api/runs/:sessionId/retry — retry a failed pipeline run from its first failed step.
 * Returns 409 if the run is not failed or the failed step does not have retryable: true.
 */

import type { FastifyInstance } from "fastify";

export type RetryPipelineLike = {
  retry(sessionId: string): Promise<any>;
};

export type RetryApiDeps = { pipeline: RetryPipelineLike };

export function registerRetryApi(app: FastifyInstance, deps: RetryApiDeps) {
  app.post<{ Params: { sessionId: string } }>(
    "/api/runs/:sessionId/retry",
    async (req, reply) => {
      try {
        const run = await deps.pipeline.retry(req.params.sessionId);
        return reply.send(run);
      } catch (err: any) {
        const msg: string = err?.message ?? String(err);
        const status = msg.startsWith('no such run') ? 404
          : msg.startsWith('cannot retry') || msg.startsWith('retry is disabled') ? 409
          : 500;
        return reply.code(status).send({ error: msg });
      }
    },
  );
}
