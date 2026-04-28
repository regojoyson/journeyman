import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  DuplicateSecretError, deleteSecret, insertOrgSecret, listOrgSecrets, updateSecret,
} from "../db.ts";

export async function registerOrgSecretRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/secrets",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rows = await listOrgSecrets(pool, orgId);
      return rows.map(r => ({
        id: r.id, name: r.name, description: r.description,
        createdBy: r.createdBy, createdAt: r.createdAt, updatedAt: r.updatedAt,
      }));
    });

  app.post("/api/orgs/:orgId/secrets",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { name?: string; value?: string; description?: string };
      if (!body?.name || !body?.value) return reply.code(400).send({ error: "Missing name or value" });
      try {
        const rec = await insertOrgSecret(pool, {
          orgId, name: body.name, value: body.value,
          description: body.description ?? null, createdBy: req.runContext!.user.id,
        });
        reply.code(201);
        return { id: rec.id, name: rec.name, description: rec.description, createdAt: rec.createdAt };
      } catch (err) {
        if (err instanceof DuplicateSecretError) return reply.code(409).send({ error: err.message });
        if (err instanceof Error && /Invalid secret name/.test(err.message)) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

  app.patch("/api/orgs/:orgId/secrets/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { value?: string; description?: string | null };
      const ok = await updateSecret(pool, {
        id, orgId, userId: null,
        value: body?.value, description: body?.description,
      });
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });

  app.delete("/api/orgs/:orgId/secrets/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const ok = await deleteSecret(pool, id, orgId, null);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });
}
