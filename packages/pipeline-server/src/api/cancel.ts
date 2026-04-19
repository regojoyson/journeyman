/**
 * @file cancel.ts
 * POST /api/runs/:sessionId/cancel — cancel an in-flight pipeline run.
 *
 * Calls `pipeline.cancel(sessionId)` which signals the run's AbortController.
 * The runner detects the abort between steps and transitions the run to "cancelled".
 * Returns the current run state (or a minimal object if the run is not found).
 * Cancelling an already-terminal run is a no-op.
 */

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
