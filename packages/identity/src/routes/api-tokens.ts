import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "../middleware.ts";
import { newApiToken } from "../tokens.ts";
import { insertApiToken, listApiTokens, revokeApiToken } from "../db.ts";

export async function registerApiTokenRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/api-tokens",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const filterUserId = ctx.role === "admin" ? null : ctx.user.id;
      return listApiTokens(pool, orgId, filterUserId);
    });

  app.post("/api/orgs/:orgId/api-tokens",
    { preHandler: requireAuth(), config: { audit: { action: "api_token.create", targetType: "api_token" } } },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { name?: string; expiresAt?: string };
      if (!body?.name) return reply.code(400).send({ error: "Missing name" });
      const { plaintext, hash } = newApiToken();
      const row = await insertApiToken(pool, {
        userId: ctx.user.id, orgId, name: body.name, tokenHash: hash,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      });
      req.auditTargetId = row.id;
      req.auditDetail = { name: row.name };
      reply.code(201);
      return { id: row.id, name: row.name, plaintext, createdAt: row.created_at, expiresAt: row.expires_at };
    });

  app.delete("/api/orgs/:orgId/api-tokens/:id",
    { preHandler: requireAuth(), config: { audit: { action: "api_token.revoke", targetType: "api_token" } } },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      if (ctx.role !== "admin") {
        const own = await listApiTokens(pool, orgId, ctx.user.id);
        if (!own.find((t: any) => t.id === id)) return reply.code(403).send({ error: "Not your token" });
      }
      await revokeApiToken(pool, id, orgId);
      return { ok: true };
    });
}
