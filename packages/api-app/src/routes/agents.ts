import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Composition } from "@journeyman/api-context";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import {
  insertAgent,
  getAgent,
  listAgents,
  updateAgent,
  deleteAgent,
  runAgentGuarded,
  wasSkipped,
  checkReadiness,
  getOrgAgentSettings,
  upsertOrgAgentSettings,
  type OrgAgentSettingsPatch,
  DuplicateAgentError,
} from "@journeyman/agents";
import type { AgentCreateInput } from "@journeyman/core";
import { canAccessOrg } from "@journeyman/core";
import { syncScheduleState, clearScheduleState } from "@journeyman/api-context";
import { listAudit } from "@journeyman/api-context";

function ctxOf(req: FastifyRequest) {
  return req.runContext!;
}

const EMPTY_AGENT_DEFAULTS = {
  instructions: "",
  inputs: [],
  provider: "claude",
  connectorMcpIds: [],
  tools: [],
  skillIds: [],
  repoSelections: [],
  permissions: { allowedTools: [] as never[] },
  notifications: { on: [] as never[] },
  outputMode: "text" as const,
  behavior: {},
  triggers: [],
  status: "draft" as const,
  enabled: false,
};

export function registerAgentRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });
  const requirePerm = makeRequireWorkspacePermission({ pool: c.pool! });
  const pool = c.pool!;

  const read = { preHandler: [requireAuth(), requirePerm("resource.read")] };
  const write = { preHandler: [requireAuth(), requirePerm("resource.write")] };

  // List agents — workspace-scoped
  app.get("/api/workspaces/:wsId/agents", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    return listAgents(pool, wsId);
  });

  // Create agent — workspace-scoped
  app.post("/api/workspaces/:wsId/agents", { ...write, config: { audit: { action: "agent.create", targetType: "agent" } } }, async (req, reply) => {
    const { wsId } = req.params as { wsId: string };
    const ctx = ctxOf(req);
    const body = req.body as { name?: unknown };
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      reply.code(400).send({ error: "name_required" });
      return;
    }
    const orgId = ctx.workspace!.orgId;
    try {
      const agent = await insertAgent(pool, {
        name,
        workspaceId: wsId,
        orgId,
        createdBy: ctx.user.id,
        ...EMPTY_AGENT_DEFAULTS,
      } as AgentCreateInput & { workspaceId: string; orgId: string; createdBy: string });
      req.auditTargetId = agent.id;
      req.auditDetail = { name };
      reply.code(201);
      return agent;
    } catch (err) {
      if (err instanceof DuplicateAgentError) {
        reply.code(409).send({ error: "duplicate_name" });
        return;
      }
      throw err;
    }
  });

  // Get
  app.get("/api/workspaces/:wsId/agents/:id", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const agent = await getAgent(pool, id);
    if (!agent || agent.workspaceId !== wsId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    return agent;
  });

  // Update (blocked while enabled — §9 enabled = read-only)
  app.patch("/api/workspaces/:wsId/agents/:id", { ...write, config: { audit: { action: "agent.update", targetType: "agent" } } }, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const existing = await getAgent(pool, id);
    if (!existing || existing.workspaceId !== wsId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    if (existing.enabled) {
      reply.code(409).send({ error: "agent_enabled_readonly" });
      return;
    }
    try {
      const updated = await updateAgent(pool, id, req.body as Record<string, unknown>);
      return updated;
    } catch (err) {
      if (err instanceof DuplicateAgentError) {
        reply.code(409).send({ error: "duplicate_name" });
        return;
      }
      throw err;
    }
  });

  // Enable — runs the readiness gate
  app.post("/api/workspaces/:wsId/agents/:id/enable", { ...write, config: { audit: { action: "agent.enable", targetType: "agent" } } }, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const agent = await getAgent(pool, id);
    if (!agent || agent.workspaceId !== wsId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    const errors = checkReadiness(agent);
    if (errors.length) {
      reply.code(422).send({ error: "not_ready", errors });
      return;
    }
    const updated = await updateAgent(pool, id, { status: "active", enabled: true });
    if (updated) await syncScheduleState(pool, updated);
    return updated;
  });

  // Disable
  app.post("/api/workspaces/:wsId/agents/:id/disable", { ...write, config: { audit: { action: "agent.disable", targetType: "agent" } } }, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const agent = await getAgent(pool, id);
    if (!agent || agent.workspaceId !== wsId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    const updated = await updateAgent(pool, id, { enabled: false });
    await clearScheduleState(pool, id);
    return updated;
  });

  // Delete
  app.delete("/api/workspaces/:wsId/agents/:id", { ...write, config: { audit: { action: "agent.delete", targetType: "agent" } } }, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const agent = await getAgent(pool, id);
    if (!agent || agent.workspaceId !== wsId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    await deleteAgent(pool, id);
    req.auditDetail = { name: agent.name };
    reply.code(204);
  });

  // Run now (manual) — compile + submit. Allowed in draft (test run) and active.
  app.post("/api/workspaces/:wsId/agents/:id/runs", { ...write, config: { audit: { action: "agent.run", targetType: "agent" } } }, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const ctx = ctxOf(req);
    const agent = await getAgent(pool, id);
    if (!agent || agent.workspaceId !== wsId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    const body = req.body as { inputs?: Record<string, unknown> };
    try {
      const res = await runAgentGuarded({ orchestrator: c.orchestrator, pool }, agent, body?.inputs ?? {}, "manual", {
        userId: ctx.user.id,
        orgId: agent.orgId,
      });
      if (wasSkipped(res)) {
        reply.code(429).send({ error: "skipped", reason: res.skipped });
        return;
      }
      req.auditDetail = { workflowInstanceId: res.workflowInstanceId };
      reply.code(202);
      return res;
    } catch (err: any) {
      reply.code(422).send({ error: "invalid_inputs", message: err?.message ?? String(err) });
      return;
    }
  });

  // Run history — instances tagged with this agentId
  app.get("/api/workspaces/:wsId/agents/:id/runs", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const agent = await getAgent(pool, id);
    if (!agent || agent.workspaceId !== wsId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT id, status, started_at, completed_at
         FROM jm_workflow_instances
        WHERE inputs->>'agentId' = $1
        ORDER BY started_at DESC NULLS LAST
        LIMIT 50`,
      [id],
    );
    return rows;
  });

  // Org agent settings — kill-switch (pause-all) + default safety limits (§15.1).
  // Workspace-wide agent runs — all runs across every agent in this workspace.
  app.get("/api/workspaces/:wsId/agent-runs", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    const q = req.query as {
      status?: string;
      agentId?: string;
      trigger?: string;
      page?: string;
      pageSize?: string;
    };

    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20) || 20));
    const offset = (page - 1) * pageSize;

    const conds: string[] = ["wi.workspace_id = $1", "wi.inputs->>'agentId' IS NOT NULL"];
    const params: unknown[] = [wsId];

    if (q.status)  { conds.push(`wi.status = $${params.push(q.status)}`); }
    if (q.agentId) { conds.push(`wi.inputs->>'agentId' = $${params.push(q.agentId)}`); }
    if (q.trigger) { conds.push(`wi.trigger_source = $${params.push(q.trigger)}`); }

    const where = conds.join(" AND ");

    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT
           wi.id, wi.status, wi.trigger_source,
           wi.started_at, wi.completed_at, wi.duration_ms,
           wi.inputs, wi.outputs,
           a.id          AS agent_id,
           a.name        AS agent_name,
           a.definition->>'provider' AS provider,
           a.definition->>'model'    AS model
         FROM jm_workflow_instances wi
         LEFT JOIN jm_agents a ON a.id = (wi.inputs->>'agentId')::uuid
         WHERE ${where}
         ORDER BY wi.started_at DESC NULLS LAST
         LIMIT ${pageSize} OFFSET ${offset}`,
        params,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n
         FROM jm_workflow_instances wi
         WHERE ${where}`,
        params,
      ),
    ]);

    return {
      runs: dataRes.rows.map(r => ({
        id: r.id,
        status: r.status,
        triggerSource: r.trigger_source,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        durationMs: r.duration_ms,
        inputs: r.inputs,
        outputs: r.outputs,
        agentId: r.agent_id,
        agentName: r.agent_name ?? "Unknown",
        provider: r.provider ?? "claude",
        model: r.model ?? null,
      })),
      total: countRes.rows[0]?.n ?? 0,
      page,
      pageSize,
    };
  });

  // These remain org-scoped (not per-agent).
  app.get("/api/orgs/:orgId/agent-settings", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = ctxOf(req);
    if (!canAccessOrg(ctx, orgId)) {
      reply.code(403).send({ error: "wrong_org" });
      return;
    }
    return getOrgAgentSettings(pool, orgId);
  });

  app.put("/api/orgs/:orgId/agent-settings", { preHandler: requireAuth(), config: { audit: { action: "org_settings.update", targetType: "org_settings" } } }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = ctxOf(req);
    if (!canAccessOrg(ctx, orgId)) {
      reply.code(403).send({ error: "wrong_org" });
      return;
    }
    const body = (req.body ?? {}) as OrgAgentSettingsPatch;
    const next = await upsertOrgAgentSettings(pool, orgId, {
      ...(typeof body.paused === "boolean" ? { paused: body.paused } : {}),
      ...(body.limits ? { limits: body.limits } : {}),
    });
    req.auditDetail = { paused: next.paused };
    return next;
  });

  // Audit log — recent sensitive actions for the org (paged via ?before=ISO&limit=N).
  app.get("/api/orgs/:orgId/audit", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = ctxOf(req);
    if (!canAccessOrg(ctx, orgId)) {
      reply.code(403).send({ error: "wrong_org" });
      return;
    }
    const q = req.query as { before?: string; limit?: string };
    return listAudit(pool, orgId, {
      before: q.before,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  });
}
