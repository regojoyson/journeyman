/**
 * @file resume.ts
 * POST /api/runs/:sessionId/resume — resume a blocked pipeline run.
 *
 * Calls `pipeline.resume(sessionId)` which locates the last blocked step in the
 * run's flowSnapshot and continues execution from the step after it. Artifacts
 * accumulated before the block are preserved.
 *
 * Returns 409 if the run is not in "blocked" status (e.g. already running, failed,
 * or completed). Returns the updated PipelineRun on success.
 */

import type { FastifyInstance } from "fastify";

export type PipelineLike = {
  resume(sessionId: string): Promise<any>;
};

export type ResumeApiDeps = { pipeline: PipelineLike };

export function registerResumeApi(app: FastifyInstance, deps: ResumeApiDeps) {
  app.post<{ Params: { sessionId: string } }>(
    "/api/runs/:sessionId/resume",
    async (req, reply) => {
      try {
        const run = await deps.pipeline.resume(req.params.sessionId);
        return reply.send(run);
      } catch (err: any) {
        return reply.code(409).send({ error: err.message });
      }
    },
  );
}
