import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  DuplicateCodingModelError,
  deleteCodingModel,
  getCodingModel,
  insertCodingModel,
  listAllCodingModels,
  updateCodingModel,
} from "../db.ts";

function requirePlatformAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.runContext?.isPlatformAdmin) {
    reply.code(403).send({ error: "Platform admin required" });
    return false;
  }
  return true;
}

export async function registerAdminCodingModelRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/admin/coding-models",
    { preHandler: requireAuth() },
    async (req, reply) => {
      if (!requirePlatformAdmin(req, reply)) return;
      return listAllCodingModels(pool);
    },
  );

  app.post(
    "/api/admin/coding-models",
    { preHandler: requireAuth() },
    async (req, reply) => {
      if (!requirePlatformAdmin(req, reply)) return;
      const b = req.body as any;
      if (!b?.provider || !b?.modelId || !b?.label) {
        return reply.code(400).send({ error: "provider, modelId, label required" });
      }
      try {
        const rec = await insertCodingModel(pool, {
          provider: String(b.provider),
          modelId: String(b.modelId),
          label: String(b.label),
          description: b.description,
          sortOrder: b.sortOrder,
          enabled: b.enabled,
          deprecated: b.deprecated,
          isDefault: b.isDefault,
          supportsThinking: b.supportsThinking,
          contextWindow: b.contextWindow,
        });
        reply.code(201);
        return rec;
      } catch (err) {
        if (err instanceof DuplicateCodingModelError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.patch(
    "/api/admin/coding-models/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      if (!requirePlatformAdmin(req, reply)) return;
      const { id } = req.params as { id: string };
      const existing = await getCodingModel(pool, id);
      if (!existing) return reply.code(404).send({ error: "Not found" });
      try {
        const updated = await updateCodingModel(pool, id, req.body as any);
        return updated;
      } catch (err) {
        if (err instanceof DuplicateCodingModelError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.delete(
    "/api/admin/coding-models/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      if (!requirePlatformAdmin(req, reply)) return;
      const { id } = req.params as { id: string };
      const ok = await deleteCodingModel(pool, id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      reply.code(204);
      return null;
    },
  );
}
