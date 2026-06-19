import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import {
  DuplicateSecretError, deleteSecret, insertWorkspaceSecret, listWorkspaceSecrets, updateSecret,
} from "../db.ts";

export async function registerWorkspaceSecretRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });
  const requirePerm = makeRequireWorkspacePermission({ pool });

  app.get("/api/workspaces/:wsId/secrets",
    { preHandler: [requireAuth(), requirePerm("resource.read")] },
    async (req) => {
      const { wsId } = req.params as { wsId: string };
      const rows = await listWorkspaceSecrets(pool, wsId);
      return rows.map(s => ({
        id: s.id, name: s.name, description: s.description,
        createdBy: s.createdBy, createdAt: s.createdAt, updatedAt: s.updatedAt,
      }));
    });

  app.post("/api/workspaces/:wsId/secrets",
    { preHandler: [requireAuth(), requirePerm("resource.write")] },
    async (req, reply) => {
      const { wsId } = req.params as { wsId: string };
      const ctx = req.runContext!;
      const body = req.body as { name?: string; value?: string; description?: string };
      if (!body?.name || !body?.value) return reply.code(400).send({ error: "Missing name or value" });
      try {
        const rec = await insertWorkspaceSecret(pool, {
          orgId: ctx.workspace!.orgId, workspaceId: wsId, name: body.name, value: body.value,
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

  app.patch("/api/workspaces/:wsId/secrets/:id",
    { preHandler: [requireAuth(), requirePerm("resource.write")] },
    async (req, reply) => {
      const { wsId, id } = req.params as { wsId: string; id: string };
      const ctx = req.runContext!;
      const body = req.body as { value?: string; description?: string | null };
      const ok = await updateSecret(pool, {
        id, orgId: ctx.workspace!.orgId, workspaceId: wsId,
        value: body?.value, description: body?.description,
      });
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });

  app.delete("/api/workspaces/:wsId/secrets/:id",
    { preHandler: [requireAuth(), requirePerm("resource.delete")] },
    async (req, reply) => {
      const { wsId, id } = req.params as { wsId: string; id: string };
      const ctx = req.runContext!;
      const ok = await deleteSecret(pool, id, ctx.workspace!.orgId, wsId);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });
}
