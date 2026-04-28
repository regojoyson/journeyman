import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { openSseStream } from "../sse/sse-stream.ts";
import { isPauseableEngine, isRetryableEngine, type RunStatus } from "@journeyman/core";
import { rerunFromExisting, forkFromRun } from "@journeyman/orchestrator";
import { makeRequireAuth } from "@journeyman/identity";

const PING_INTERVAL_MS = 15_000;

export function registerRunRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });

  app.get("/runs", { preHandler: requireAuth() }, async (req) => {
    const q = req.query as { flow_id?: string; status?: string; limit?: string };
    const limit = q.limit ? Number(q.limit) : undefined;
    const status = q.status as RunStatus | undefined;
    const runs = await c.runs.list({ flowId: q.flow_id, status, limit });
    return { runs };
  });

  app.get("/runs/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await c.orchestrator.syncStatus(id).catch(() => { /* best-effort */ });
    const run = await c.runs.getById(id);
    if (!run) { reply.code(404); return { error: "not_found" }; }
    const executions = await c.nodeExecutions.listByRun(id);
    const events = await c.events.list(id, { limit: 500 });
    return { run, executions, events };
  });

  app.get("/runs/:id/events", { preHandler: requireAuth() }, async (req, reply) => {
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

  app.post("/runs/:id/cancel", { preHandler: requireAuth() }, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { reason?: string };
    await c.orchestrator.cancel(id, body.reason);
    return { ok: true };
  });

  app.post("/runs/:id/pause", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isPauseableEngine(c.orchestrator)) {
      reply.code(501); return { error: "pause_not_supported_by_engine" };
    }
    await c.orchestrator.pause(id);
    return { ok: true };
  });

  app.post("/runs/:id/resume", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isPauseableEngine(c.orchestrator)) {
      reply.code(501); return { error: "resume_not_supported_by_engine" };
    }
    await c.orchestrator.resume(id);
    return { ok: true };
  });

  app.post("/runs/:id/retry-step", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { node_id?: string };
    if (!isRetryableEngine(c.orchestrator)) {
      reply.code(501); return { error: "retry_not_supported_by_engine" };
    }
    await c.orchestrator.retryFromTask(id, body.node_id);
    return { ok: true };
  });

  app.post("/runs/:id/rerun", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = await c.auth.authenticate(req);
    const result = await rerunFromExisting(
      { runs: c.runs, flowVersions: c.flowVersions, orchestrator: c.orchestrator },
      id,
      { startedByUserId: user.userId },
    );
    reply.code(202);
    return result;
  });

  app.post("/runs/:id/fork", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { name?: string };
    const user = await c.auth.authenticate(req);
    const result = await forkFromRun(
      { runs: c.runs, flows: c.flows, flowVersions: c.flowVersions },
      id,
      { name: body.name, createdByUserId: user.userId, ownerUserId: user.userId },
    );
    reply.code(201);
    return result;
  });

  app.get("/runs/:id/export", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await c.runs.getById(id);
    if (!run) { reply.code(404); return { error: "not_found" }; }
    const version = await c.flowVersions.getById(run.flowVersionId);
    const executions = await c.nodeExecutions.listByRun(id);
    const events = await c.events.list(id, { limit: 5000 });
    reply.header("Content-Type", "application/json");
    reply.header("Content-Disposition", `attachment; filename="run-${id}.json"`);
    return {
      exportedAt: new Date().toISOString(),
      run, version, executions, events,
    };
  });
}
