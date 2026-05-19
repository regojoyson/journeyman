import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  DuplicateMcpInstanceError,
  InvalidMcpInputError,
  deleteMcpInstance,
  getMcpInstance,
  insertMcpInstance,
  listMcpInstances,
  updateMcpInstance,
} from "../db.ts";

export async function registerUserMcpRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/users/me/mcp-instances",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rows = await listMcpInstances(pool, orgId, ctx.user.id);
      return rows;
    });

  app.post("/api/orgs/:orgId/users/me/mcp-instances",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as any;
      try {
        const rec = await insertMcpInstance(pool, {
          orgId,
          userId: ctx.user.id,
          name: body.name,
          description: body.description ?? null,
          transport: body.transport,
          command: body.command ?? null,
          args: body.args ?? null,
          url: body.url ?? null,
          bindings: body.bindings ?? [],
          systemPrompt: body.systemPrompt ?? null,
          enabled: body.enabled ?? true,
          createdBy: ctx.user.id,
        });
        reply.code(201);
        return rec;
      } catch (err) {
        if (err instanceof DuplicateMcpInstanceError) return reply.code(409).send({ error: err.message });
        if (err instanceof InvalidMcpInputError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

  app.get("/api/orgs/:orgId/users/me/mcp-instances/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rec = await getMcpInstance(pool, id, orgId, ctx.user.id);
      if (!rec) return reply.code(404).send({ error: "Not found" });
      return rec;
    });

  app.patch("/api/orgs/:orgId/users/me/mcp-instances/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as any;
      try {
        const ok = await updateMcpInstance(pool, {
          id, orgId, userId: ctx.user.id,
          description: body.description,
          command: body.command,
          args: body.args,
          url: body.url,
          bindings: body.bindings,
          systemPrompt: body.systemPrompt,
          enabled: body.enabled,
        });
        if (!ok) return reply.code(404).send({ error: "Not found" });
        return { ok: true };
      } catch (err) {
        if (err instanceof InvalidMcpInputError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

  app.delete("/api/orgs/:orgId/users/me/mcp-instances/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const ok = await deleteMcpInstance(pool, id, orgId, ctx.user.id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });
}
