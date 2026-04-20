/**
 * @file resume.ts
 * POST /api/runs/:sessionId/resume — resume a blocked pipeline run.
 *
 * Optional JSON body: { ticketStatus?: string }
 * When provided, the ticket status is stored in ctx.artifacts.__resumeStatus so
 * the blocked phase can react (used by reviewLoop and awaitTicketStatus).
 */

import type { FastifyInstance } from "fastify";

export type PipelineLike = {
  resume(sessionId: string, opts?: { ticketStatus?: string }): Promise<any>;
};

export type ResumeApiDeps = { pipeline: PipelineLike };

export function registerResumeApi(app: FastifyInstance, deps: ResumeApiDeps) {
  app.post<{ Params: { sessionId: string }; Body?: { ticketStatus?: string } }>(
    "/api/runs/:sessionId/resume",
    async (req, reply) => {
      try {
        const opts = req.body && typeof req.body === "object" ? { ticketStatus: req.body.ticketStatus } : undefined;
        const run = await deps.pipeline.resume(req.params.sessionId, opts);
        return reply.send(run);
      } catch (err: any) {
        return reply.code(409).send({ error: err.message });
      }
    },
  );
}
