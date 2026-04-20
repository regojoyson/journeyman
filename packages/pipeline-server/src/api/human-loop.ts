/**
 * @file human-loop.ts
 * POST /api/human-loop/advance — manually advance a blocked run by (productId, ticketKey).
 *
 * Body: { productId: string; ticketKey: string; status: string }
 * Looks up the active blocked run via state.findActiveForTicket and calls
 * pipeline.resume(sessionId, { ticketStatus: status }). Intended for Slack
 * buttons, UI, or testing — webhooks use the dispatcher path instead.
 */

import type { FastifyInstance } from "fastify";
import type { IStateStore } from "@journeyman/core";

export type PipelineLike = {
  resume(sessionId: string, opts?: { ticketStatus?: string }): Promise<any>;
};

export type HumanLoopApiDeps = {
  pipeline: PipelineLike;
  state: IStateStore;
};

export function registerHumanLoopApi(app: FastifyInstance, deps: HumanLoopApiDeps) {
  app.post<{ Body: { productId: string; ticketKey: string; status: string } }>(
    "/api/human-loop/advance",
    async (req, reply) => {
      const { productId, ticketKey, status } = req.body ?? ({} as any);
      if (!productId || !ticketKey || !status) {
        return reply.code(400).send({ error: "productId, ticketKey, and status are required" });
      }

      const run = await deps.state.findActiveForTicket(productId, ticketKey);
      if (!run) {
        return reply.code(404).send({ error: `no active run for ${productId}/${ticketKey}` });
      }
      if (run.status !== "blocked") {
        return reply.code(409).send({ error: `run ${run.sessionId} is ${run.status}, not blocked` });
      }

      try {
        await deps.pipeline.resume(run.sessionId, { ticketStatus: status });
        return reply.send({ sessionId: run.sessionId, previousStatus: "blocked", triggeredWith: status });
      } catch (err: any) {
        return reply.code(500).send({ error: err?.message ?? String(err) });
      }
    },
  );
}
