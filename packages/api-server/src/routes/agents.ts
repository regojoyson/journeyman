import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Composition } from "../composition.ts";
import { makeRequireAuth } from "@journeyman/identity";
import {
  insertAgent,
  getAgent,
  listAgents,
  updateAgent,
  deleteAgent,
  compileAgentToGraph,
  checkReadiness,
  DuplicateAgentError,
} from "@journeyman/agents";
import type { AgentCreateInput } from "@journeyman/core";

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
  const pool = c.pool!;

  const wrongOrg = (ctx: { org: { id: string } }, orgId: string, reply: FastifyReply) => {
    if (ctx.org.id !== orgId) {
      reply.code(403).send({ error: "wrong_org" });
      return true;
    }
    return false;
  };

  // List (user-scoped)
  app.get("/api/orgs/:orgId/users/me/agents", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    return listAgents(pool, orgId, ctx.user.id);
  });

  // List (org-scoped)
  app.get("/api/orgs/:orgId/agents", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    return listAgents(pool, orgId, null);
  });

  const createHandler = (scope: "user" | "org") => async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const body = req.body as { name?: unknown };
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      reply.code(400).send({ error: "name_required" });
      return;
    }
    try {
      const agent = await insertAgent(pool, {
        scope,
        name,
        orgId,
        userId: scope === "user" ? ctx.user.id : null,
        createdBy: ctx.user.id,
        ...EMPTY_AGENT_DEFAULTS,
      } as AgentCreateInput & { orgId: string; userId: string | null; createdBy: string });
      reply.code(201);
      return agent;
    } catch (err) {
      if (err instanceof DuplicateAgentError) {
        reply.code(409).send({ error: "duplicate_name" });
        return;
      }
      throw err;
    }
  };

  app.post("/api/orgs/:orgId/users/me/agents", { preHandler: requireAuth() }, createHandler("user"));
  app.post("/api/orgs/:orgId/agents", { preHandler: requireAuth() }, createHandler("org"));

  // Get
  app.get("/api/orgs/:orgId/agents/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const agent = await getAgent(pool, id);
    if (!agent || agent.orgId !== orgId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    return agent;
  });

  // Update (blocked while enabled — §9 enabled = read-only)
  app.patch("/api/orgs/:orgId/agents/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const existing = await getAgent(pool, id);
    if (!existing || existing.orgId !== orgId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    if (existing.enabled) {
      reply.code(409).send({ error: "agent_enabled_readonly" });
      return;
    }
    try {
      return await updateAgent(pool, id, req.body as Record<string, unknown>);
    } catch (err) {
      if (err instanceof DuplicateAgentError) {
        reply.code(409).send({ error: "duplicate_name" });
        return;
      }
      throw err;
    }
  });

  // Enable — runs the readiness gate
  app.post("/api/orgs/:orgId/agents/:id/enable", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const agent = await getAgent(pool, id);
    if (!agent || agent.orgId !== orgId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    const errors = checkReadiness(agent);
    if (errors.length) {
      reply.code(422).send({ error: "not_ready", errors });
      return;
    }
    return updateAgent(pool, id, { status: "active", enabled: true });
  });

  // Disable
  app.post("/api/orgs/:orgId/agents/:id/disable", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const agent = await getAgent(pool, id);
    if (!agent || agent.orgId !== orgId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    return updateAgent(pool, id, { enabled: false });
  });

  // Delete
  app.delete("/api/orgs/:orgId/agents/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const agent = await getAgent(pool, id);
    if (!agent || agent.orgId !== orgId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    await deleteAgent(pool, id);
    reply.code(204);
  });

  // Run now (manual) — compile + submit. Allowed in draft (test run) and active.
  app.post("/api/orgs/:orgId/agents/:id/runs", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const agent = await getAgent(pool, id);
    if (!agent || agent.orgId !== orgId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    const body = req.body as { inputs?: Record<string, unknown> };
    let compiled;
    try {
      compiled = compileAgentToGraph(agent, body?.inputs ?? {});
    } catch (err: any) {
      reply.code(422).send({ error: "invalid_inputs", message: err?.message ?? String(err) });
      return;
    }

    const { workflowInstanceId, engineWorkflowId } = await c.orchestrator.submit({
      workflowId: null,
      workflowVersionId: null,
      workflowNameSnapshot: agent.name,
      workflowScopeSnapshot: agent.scope,
      definitionSnapshot: compiled.graph,
      inputs: { ...compiled.inputs, agentId: agent.id },
      startedByUserId: ctx.user.id,
      startedByOrgId: orgId,
      triggerSource: "manual",
      triggerNodeId: "trigger-1",
    });
    reply.code(202);
    return { workflowInstanceId, engineWorkflowId };
  });

  // Run history — instances tagged with this agentId (isolated query; no shared-store change).
  app.get("/api/orgs/:orgId/agents/:id/runs", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
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
}
