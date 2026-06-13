import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  insertBuilderSession,
  listBuilderSessions,
  getBuilderSession,
  updateBuilderSession,
  deleteBuilderSession,
} from "../db.ts";

export async function registerBuilderSessionRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/users/me/builder/sessions",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listBuilderSessions(pool, orgId, ctx.user.id);
    });

  app.post("/api/orgs/:orgId/users/me/builder/sessions",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { name?: string; messages?: unknown[]; buildPlan?: unknown };
      if (!body?.name || typeof body.name !== "string") {
        return reply.code(400).send({ error: "name is required" });
      }
      const rec = await insertBuilderSession(pool, {
        orgId,
        userId: ctx.user.id,
        name: body.name,
        createdBy: ctx.user.id,
        messages: body.messages ?? [],
        buildPlan: (body.buildPlan as never) ?? null,
      });
      reply.code(201);
      return rec;
    });

  app.get("/api/orgs/:orgId/users/me/builder/sessions/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rec = await getBuilderSession(pool, id, orgId, ctx.user.id);
      if (!rec) return reply.code(404).send({ error: "Not found" });
      return rec;
    });

  app.patch("/api/orgs/:orgId/users/me/builder/sessions/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as {
        name?: string; status?: "active" | "applied" | "archived";
        messages?: unknown[]; buildPlan?: unknown; appliedFlowId?: string | null;
      };
      const ok = await updateBuilderSession(pool, {
        id, orgId, userId: ctx.user.id,
        name: body.name,
        status: body.status,
        messages: body.messages,
        buildPlan: body.buildPlan as never,
        appliedFlowId: body.appliedFlowId,
      });
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });

  app.delete("/api/orgs/:orgId/users/me/builder/sessions/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const ok = await deleteBuilderSession(pool, id, orgId, ctx.user.id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });
}
