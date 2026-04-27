import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { openSseStream } from "../sse/sse-stream.ts";
import type { RunStatus } from "@journeyman/core";

const PING_INTERVAL_MS = 15_000;

export function registerRunRoutes(app: FastifyInstance, c: Composition): void {
  app.get("/runs", async (req) => {
    const q = req.query as { flow_id?: string; status?: string; limit?: string };
    const limit = q.limit ? Number(q.limit) : undefined;
    const status = q.status as RunStatus | undefined;
    const runs = await c.runs.list({ flowId: q.flow_id, status, limit });
    return { runs };
  });

  app.get("/runs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await c.orchestrator.syncStatus(id).catch(() => { /* best-effort */ });
    const run = await c.runs.getById(id);
    if (!run) { reply.code(404); return { error: "not_found" }; }
    const executions = await c.nodeExecutions.listByRun(id);
    const events = await c.events.list(id, { limit: 500 });
    return { run, executions, events };
  });

  app.get("/runs/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    const sinceId = (req.query as { since?: string }).since;
    const since = sinceId ? Number(sinceId) : 0;

    const run = await c.runs.getById(id);
    if (!run) { reply.code(404); return { error: "not_found" }; }

    const stream = openSseStream(reply);
    const ping = setInterval(() => stream.ping(), PING_INTERVAL_MS);
    let closed = false;
    reply.raw.on("close", () => { closed = true; clearInterval(ping); });

    try {
      const backfill = await c.events.list(id, { sinceId: since });
      for (const ev of backfill) {
        if (closed) return;
        stream.send({ id: ev.id, event: ev.eventType, data: ev });
      }
      const start = backfill.at(-1)?.id ?? since;
      for await (const ev of c.events.subscribe(id, { sinceId: start })) {
        if (closed) break;
        stream.send({ id: ev.id, event: ev.eventType, data: ev });
        if (ev.eventType === "run.completed" || ev.eventType === "run.failed" || ev.eventType === "run.cancelled") {
          setTimeout(() => stream.close(), 500);
          break;
        }
      }
    } finally {
      clearInterval(ping);
      await stream.close();
    }
  });
}
