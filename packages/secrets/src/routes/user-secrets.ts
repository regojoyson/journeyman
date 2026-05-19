import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  DuplicateSecretError, deleteSecret, insertUserSecret, listUserSecrets, updateSecret,
} from "../db.ts";

export async function registerUserSecretRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/users/me/secrets",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rows = await listUserSecrets(pool, orgId, ctx.user.id);
      return rows.map(r => ({
        id: r.id, name: r.name, description: r.description,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
      }));
    });

  app.post("/api/orgs/:orgId/users/me/secrets",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { name?: string; value?: string; description?: string };
      if (!body?.name || !body?.value) return reply.code(400).send({ error: "Missing name or value" });
      try {
        const rec = await insertUserSecret(pool, {
          orgId, userId: ctx.user.id, name: body.name, value: body.value,
          description: body.description ?? null, createdBy: ctx.user.id,
        });
        reply.code(201);
        return { id: rec.id, name: rec.name, description: rec.description, createdAt: rec.createdAt };
      } catch (err) {
        if (err instanceof DuplicateSecretError) return reply.code(409).send({ error: err.message });
        if (err instanceof Error && /Invalid secret name/.test(err.message)) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

  app.patch("/api/orgs/:orgId/users/me/secrets/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { value?: string; description?: string | null };
      const ok = await updateSecret(pool, {
        id, orgId, userId: ctx.user.id,
        value: body?.value, description: body?.description,
      });
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });

  app.delete("/api/orgs/:orgId/users/me/secrets/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const ok = await deleteSecret(pool, id, orgId, ctx.user.id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });
}
