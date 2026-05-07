import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Composition } from "../composition.ts";
import { openSseStream } from "../sse/sse-stream.ts";
import {
  isPauseableEngine, isRetryableEngine,
  type ActorContext, type WorkflowInstanceGrantRole, type WorkflowInstanceListScope, type WorkflowInstanceStatus,
} from "@journeyman/core";
import { rerunFromExisting, forkFromWorkflowInstance } from "@journeyman/orchestrator";
import { makeRequireAuth } from "@journeyman/identity";
import { makeRequireWorkflowInstanceRole } from "../auth/require-run-role.ts";
import { reconcileWorkflowInstance } from "../services/engine-reconciler.ts";

const PING_INTERVAL_MS = 15_000;

function actorFrom(req: FastifyRequest): ActorContext {
  const ctx = req.runContext!;
  return {
    userId: ctx.user.id,
    orgId: ctx.org.id,
    isPlatformAdmin: ctx.isPlatformAdmin,
    role: ctx.role,
  };
}

export function registerWorkflowInstanceRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });
  const requireWorkflowInstanceRole = makeRequireWorkflowInstanceRole(c);

  app.get("/workflow-instances", { preHandler: requireAuth() }, async (req, reply) => {
    const q = req.query as { workflow_id?: string; status?: string; limit?: string; scope?: string; provider?: string; issue_ref?: string };
    const scope = q.scope as WorkflowInstanceListScope | undefined;
    const actor = actorFrom(req);

    if (scope === "all" && !actor.isPlatformAdmin) {
      reply.code(403);
      return { error: "platform_admin_required" };
    }

    const workflowInstances = await c.workflowInstances.list({
      workflowId: q.workflow_id,
      status: q.status as WorkflowInstanceStatus | undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      actor,
      scope,
      provider: q.provider,
      issueRef: q.issue_ref,
    });

    const roleMap = await c.workflowInstanceGrants.matchForActor(actor, workflowInstances.map(r => r.id));
    const hydrated = workflowInstances.map(r => ({ ...r, effectiveRole: roleMap.get(r.id) ?? null }));
    return { workflowInstances: hydrated };
  });

  app.get("/workflow-instances/:id",
    { preHandler: [requireAuth(), requireWorkflowInstanceRole("viewer")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await c.orchestrator.syncStatus(id).catch(() => { /* best-effort */ });
      await reconcileWorkflowInstance(c, id).catch(() => { /* best-effort */ });
      const workflowInstance = await c.workflowInstances.getById(id);
      if (!workflowInstance) { reply.code(404); return { error: "not_found" }; }
      const executions = await c.nodeExecutions.listByWorkflowInstance(id);
      const events = await c.events.list(id, { limit: 500 });
      const effectiveWorkflowInstanceRole = (req as any).effectiveWorkflowInstanceRole as WorkflowInstanceGrantRole | undefined;
      const webhookEvent = workflowInstance.webhookEventId
        ? await c.webhookEvents.getById(workflowInstance.webhookEventId)
        : null;
      const webhookEventSummary = webhookEvent ? {
        id: webhookEvent.id,
        provider: webhookEvent.provider,
        eventType: webhookEvent.eventType,
        issueRef: webhookEvent.issueRef,
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
        workflowInstance: { ...workflowInstance, effectiveRole: effectiveWorkflowInstanceRole ?? null },
        executions,
        events,
        webhookEvent: webhookEventSummary,
        pendingHumanTask,
        humanTaskHistory,
      };
    },
  );

  app.get("/workflow-instances/:id/events",
    { preHandler: [requireAuth(), requireWorkflowInstanceRole("viewer")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sinceId = (req.query as { since?: string }).since;
      const since = sinceId ? Number(sinceId) : 0;

      const workflowInstance = await c.workflowInstances.getById(id);
      if (!workflowInstance) { reply.code(404); return { error: "not_found" }; }

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
    },
  );

  app.post("/workflow-instances/:id/cancel",
    { preHandler: [requireAuth(), requireWorkflowInstanceRole("owner")] },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { reason?: string };
      await c.orchestrator.cancel(id, body.reason);
      return { ok: true };
    },
  );

  app.post("/workflow-instances/:id/pause",
    { preHandler: [requireAuth(), requireWorkflowInstanceRole("owner")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!isPauseableEngine(c.orchestrator)) {
        reply.code(501); return { error: "pause_not_supported_by_engine" };
      }
      await c.orchestrator.pause(id);
      return { ok: true };
    },
  );

  app.post("/workflow-instances/:id/resume",
    { preHandler: [requireAuth(), requireWorkflowInstanceRole("owner")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!isPauseableEngine(c.orchestrator)) {
        reply.code(501); return { error: "resume_not_supported_by_engine" };
      }
      await c.orchestrator.resume(id);
      return { ok: true };
    },
  );

  app.post("/workflow-instances/:id/retry-step",
    { preHandler: [requireAuth(), requireWorkflowInstanceRole("owner")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { node_id?: string };
      if (!isRetryableEngine(c.orchestrator)) {
        reply.code(501); return { error: "retry_not_supported_by_engine" };
      }
      await c.orchestrator.retryFromTask(id, body.node_id);
      return { ok: true };
    },
  );

  app.post("/workflow-instances/:id/rerun",
    { preHandler: [requireAuth(), requireWorkflowInstanceRole("owner")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = req.runContext!;
      const result = await rerunFromExisting(
        { workflowInstances: c.workflowInstances, workflowVersions: c.workflowVersions, orchestrator: c.orchestrator },
        id,
        { startedByUserId: ctx.user.id, startedByOrgId: ctx.org.id },
      );
      reply.code(202);
      return result;
    },
  );

  app.post("/workflow-instances/:id/fork",
    { preHandler: [requireAuth(), requireWorkflowInstanceRole("owner")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { name?: string };
      const ctx = req.runContext!;
      const result = await forkFromWorkflowInstance(
        { workflowInstances: c.workflowInstances, workflows: c.workflows, workflowVersions: c.workflowVersions },
        id,
        { name: body.name, createdByUserId: ctx.user.id, ownerUserId: ctx.user.id },
      );
      reply.code(201);
      return result;
    },
  );

  app.get("/workflow-instances/:id/export",
    { preHandler: [requireAuth(), requireWorkflowInstanceRole("viewer")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const workflowInstance = await c.workflowInstances.getById(id);
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
    },
  );
}

function parseDurationMsLite(input: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)$/.exec(input.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return n * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const)[m[2] as "ms"];
}
