import type { FastifyInstance } from "fastify";
import type { ITraceLogger, TraceLine } from "@journeyman/core";

export type LogsApiDeps = { trace: ITraceLogger };

export function registerLogsApi(app: FastifyInstance, deps: LogsApiDeps) {
  app.get<{ Params: { sessionId: string }; Querystring: { stepId?: string; tail?: string } }>(
    "/api/runs/:sessionId/logs",
    async (req) => {
      const tail = req.query.tail ? parseInt(req.query.tail, 10) : undefined;
      const lines: TraceLine[] = [];
      for await (const l of deps.trace.read(req.params.sessionId, { stepId: req.query.stepId, tail })) {
        lines.push(l);
      }
      return { lines };
    },
  );
}
