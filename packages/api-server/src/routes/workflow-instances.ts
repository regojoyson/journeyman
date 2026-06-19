import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { openSseStream } from "../sse/sse-stream.ts";
import {
  isPauseableEngine, isRetryableEngine,
  type WorkflowInstanceStatus,
} from "@journeyman/core";
import { rerunFromExisting, forkFromWorkflowInstance } from "@journeyman/orchestrator";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import { reconcileWorkflowInstance } from "../services/engine-reconciler.ts";

const PING_INTERVAL_MS = 15_000;

export function registerWorkflowInstanceRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });
  const requirePerm = makeRequireWorkspacePermission({ pool: c.pool! });
  const read = { preHandler: [requireAuth(), requirePerm("resource.read")] };
  const write = { preHandler: [requireAuth(), requirePerm("resource.write")] };

  /** Load an instance and 404 unless it belongs to the route's workspace. */
  async function loadInstance(id: string, wsId: string) {
    const wi = await c.workflowInstances.getById(id);
    if (!wi || wi.workspaceId !== wsId) return null;
    return wi;
  }

  app.get("/workspaces/:wsId/workflow-instances", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    const q = req.query as { workflow_id?: string; status?: string; limit?: string; page?: string; page_size?: string; provider?: string };

    const paginated = q.page !== undefined || q.page_size !== undefined;
    const filterOpts = {
      workspaceId: wsId,
      workflowId: q.workflow_id,
      status: q.status as WorkflowInstanceStatus | undefined,
      provider: q.provider,
    };

    if (paginated) {
      const page = Math.max(1, Number(q.page ?? 1) || 1);
      const requestedSize = Number(q.page_size ?? 25) || 25;
      const pageSize = Math.min(100, Math.max(1, requestedSize));
      const offset = (page - 1) * pageSize;

      const [workflowInstances, total] = await Promise.all([
        c.workflowInstances.list({ ...filterOpts, limit: pageSize, offset }),
        c.workflowInstances.count(filterOpts),
      ]);
      return { workflowInstances, total, page, pageSize };
    }

    const workflowInstances = await c.workflowInstances.list({
      ...filterOpts,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return { workflowInstances };
  });

  app.get("/workspaces/:wsId/workflow-instances/:id", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    if (!(await loadInstance(id, wsId))) { reply.code(404); return { error: "not_found" }; }
    await c.orchestrator.syncStatus(id).catch(() => { /* best-effort */ });
    await reconcileWorkflowInstance(c, id).catch(() => { /* best-effort */ });
    const workflowInstance = await c.workflowInstances.getById(id);
    if (!workflowInstance) { reply.code(404); return { error: "not_found" }; }
    const executions = await c.nodeExecutions.listByWorkflowInstance(id);
    const events = await c.events.list(id, { limit: 500 });
    const webhookEvent = workflowInstance.webhookEventId
      ? await c.webhookEvents.getById(workflowInstance.webhookEventId)
      : null;
    const webhook = webhookEvent?.webhookId
      ? await c.webhooks.getById(webhookEvent.webhookId)
      : null;
    const webhookEventSummary = webhookEvent ? {
      id: webhookEvent.id,
      provider: webhookEvent.provider,
      webhookName: webhook?.name ?? null,
      eventType: webhookEvent.eventType,
      deliveryId: webhookEvent.deliveryId,
      receivedAt: webhookEvent.receivedAt.toISOString(),
      rawPayload: webhookEvent.rawPayload,
    } : null;

    const waitingExec = await c.nodeExecutions.latestWaitingForInstance(id);
    let pendingHumanTask: {
      nodeId: string;
      prompt?: string;
      outputs: Array<{
        name: string;
        type: "string" | "number" | "boolean" | "json" | "date";
        label?: string;
        description?: string;
        required?: boolean;
        default?: unknown;
      }>;
      startedAt: string;
      timeout?: { durationMs: number };
    } | null = null;
    if (waitingExec) {
      const node = workflowInstance.definitionSnapshot.nodes.find(n => n.id === waitingExec.nodeId);
      if (node?.type === "human-task") {
        const cfg = (node.config ?? {}) as {
          prompt?: string;
          outputs?: Array<{
            name: string;
            type: "string" | "number" | "boolean" | "json" | "date";
            label?: string;
            description?: string;
            required?: boolean;
            default?: unknown;
            fromPath?: string;
          }>;
          timeout?: { duration: string };
        };
        pendingHumanTask = {
          nodeId: node.id,
          prompt: cfg.prompt,
          outputs: (cfg.outputs ?? []).map(({ fromPath: _drop, ...rest }) => rest),
          startedAt: (waitingExec.startedAt ?? new Date()).toISOString(),
          ...(cfg.timeout
            ? { timeout: { durationMs: parseDurationMsLite(cfg.timeout.duration) } }
            : {}),
        };
      }
    }
    const humanTaskHistory = await c.humanTaskResolutions.listForRun(id);

    return {
      workflowInstance,
      executions,
      events,
      webhookEvent: webhookEventSummary,
      pendingHumanTask,
      humanTaskHistory,
    };
  });

  app.get("/workspaces/:wsId/workflow-instances/:id/events", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    if (!(await loadInstance(id, wsId))) { reply.code(404); return { error: "not_found" }; }
    const sinceId = (req.query as { since?: string }).since;
    const since = sinceId ? Number(sinceId) : 0;

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
        if (
          ev.eventType === "workflow_instance.completed" ||
          ev.eventType === "workflow_instance.failed" ||
          ev.eventType === "workflow_instance.cancelled"
        ) {
          setTimeout(() => stream.close(), 500);
          break;
        }
      }
    } finally {
      clearInterval(ping);
      await stream.close();
    }
  });

  app.post("/workspaces/:wsId/workflow-instances/:id/cancel", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    if (!(await loadInstance(id, wsId))) { reply.code(404); return { error: "not_found" }; }
    const body = (req.body ?? {}) as { reason?: string };
    await c.orchestrator.cancel(id, body.reason);
    return { ok: true };
  });

  app.post("/workspaces/:wsId/workflow-instances/:id/pause", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    if (!(await loadInstance(id, wsId))) { reply.code(404); return { error: "not_found" }; }
    if (!isPauseableEngine(c.orchestrator)) {
      reply.code(501); return { error: "pause_not_supported_by_engine" };
    }
    await c.orchestrator.pause(id);
    return { ok: true };
  });

  app.post("/workspaces/:wsId/workflow-instances/:id/resume", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    if (!(await loadInstance(id, wsId))) { reply.code(404); return { error: "not_found" }; }
    if (!isPauseableEngine(c.orchestrator)) {
      reply.code(501); return { error: "resume_not_supported_by_engine" };
    }
    await c.orchestrator.resume(id);
    return { ok: true };
  });

  app.post("/workspaces/:wsId/workflow-instances/:id/retry-step", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    if (!(await loadInstance(id, wsId))) { reply.code(404); return { error: "not_found" }; }
    const body = (req.body ?? {}) as { node_id?: string };
    if (!isRetryableEngine(c.orchestrator)) {
      reply.code(501); return { error: "retry_not_supported_by_engine" };
    }
    await c.orchestrator.retryFromTask(id, body.node_id);
    return { ok: true };
  });

  app.post("/workspaces/:wsId/workflow-instances/:id/rerun", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    if (!(await loadInstance(id, wsId))) { reply.code(404); return { error: "not_found" }; }
    const ctx = req.runContext!;
    const result = await rerunFromExisting(
      { workflowInstances: c.workflowInstances, workflowVersions: c.workflowVersions, orchestrator: c.orchestrator },
      id,
      { startedByUserId: ctx.user.id, startedByOrgId: ctx.workspace?.orgId ?? ctx.org.id },
    );
    reply.code(202);
    return result;
  });

  app.post("/workspaces/:wsId/workflow-instances/:id/fork", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    if (!(await loadInstance(id, wsId))) { reply.code(404); return { error: "not_found" }; }
    const body = (req.body ?? {}) as { name?: string };
    const ctx = req.runContext!;
    const result = await forkFromWorkflowInstance(
      { workflowInstances: c.workflowInstances, workflows: c.workflows, workflowVersions: c.workflowVersions },
      id,
      { name: body.name, createdByUserId: ctx.user.id, ownerUserId: ctx.user.id },
    );
    reply.code(201);
    return result;
  });

  app.get("/workspaces/:wsId/workflow-instances/:id/export", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const workflowInstance = await loadInstance(id, wsId);
    if (!workflowInstance) { reply.code(404); return { error: "not_found" }; }
    const version = workflowInstance.workflowVersionId ? await c.workflowVersions.getById(workflowInstance.workflowVersionId) : null;
    const executions = await c.nodeExecutions.listByWorkflowInstance(id);
    const events = await c.events.list(id, { limit: 5000 });
    reply.header("Content-Type", "application/json");
    reply.header("Content-Disposition", `attachment; filename="workflow-instance-${id}.json"`);
    return {
      exportedAt: new Date().toISOString(),
      workflowInstance, version, executions, events,
    };
  });
}

function parseDurationMsLite(input: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)$/.exec(input.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return n * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const)[m[2] as "ms"];
}
