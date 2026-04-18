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
