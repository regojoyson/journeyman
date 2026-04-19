/**
 * @file logs.ts
 * GET /api/runs/:sessionId/logs — retrieve structured trace log lines for a run.
 *
 * Query params:
 *   ?stepId=<id>  — restrict to log lines from one step.
 *   ?tail=<n>     — return only the last N lines (across all steps, sorted by timestamp).
 *
 * Returns `{ lines: TraceLine[] }` where each TraceLine has ts, level, stepId, message,
 * and optional meta. Lines are sorted chronologically.
 */

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
