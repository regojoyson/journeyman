import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { CANONICAL_TOOLS, isCanonicalTool, type CanonicalTool } from "@journeyman/core";
import {
  DuplicateCustomPhaseError,
  deleteCustomAiPhase,
  getCustomAiPhase,
  insertCustomAiPhase,
  listCustomAiPhases,
  promoteCustomAiPhaseToOrg,
  updateCustomAiPhase,
} from "../db.ts";

function parseDefaultTools(raw: unknown): CanonicalTool[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("defaultTools must be an array of canonical tool names");
  }
  const seen = new Set<string>();
  for (const t of raw) {
    if (!isCanonicalTool(t)) {
      throw new Error(
        `defaultTools contains invalid tool '${String(t)}'. Allowed: ${CANONICAL_TOOLS.join(", ")}`,
      );
    }
    if (seen.has(t)) throw new Error(`defaultTools contains duplicate '${t}'`);
    seen.add(t);
  }
  return raw as CanonicalTool[];
}

export async function registerUserCustomPhaseRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/orgs/:orgId/users/me/custom-phases",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listCustomAiPhases(pool, orgId, ctx.user.id);
    },
  );

  app.post(
    "/api/orgs/:orgId/users/me/custom-phases",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as any;
      try {
        const rec = await insertCustomAiPhase(pool, {
          orgId,
          userId: ctx.user.id,
          createdBy: ctx.user.id,
          scope: "user",
          name: body.name,
          description: body.description,
          inputFields: body.inputFields,
          outputMode: body.outputMode,
          outputSchema: body.outputSchema,
          promptTemplate: body.promptTemplate,
          defaultTools: parseDefaultTools(body.defaultTools),
          defaultMcpIds: body.defaultMcpIds,
          defaultSkillIds: body.defaultSkillIds,
        });
        reply.code(201);
        return rec;
      } catch (err) {
        if (err instanceof DuplicateCustomPhaseError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );

  app.get(
    "/api/orgs/:orgId/users/me/custom-phases/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rec = await getCustomAiPhase(pool, id);
      if (!rec || rec.orgId !== orgId || rec.userId !== ctx.user.id) {
        return reply.code(404).send({ error: "Not found" });
      }
      return rec;
    },
  );

  app.patch(
    "/api/orgs/:orgId/users/me/custom-phases/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const existing = await getCustomAiPhase(pool, id);
      if (!existing || existing.orgId !== orgId || existing.userId !== ctx.user.id) {
        return reply.code(404).send({ error: "Not found" });
      }
      try {
        const patchBody = req.body as any;
        const patch = {
          ...patchBody,
          ...(patchBody?.defaultTools !== undefined
            ? { defaultTools: parseDefaultTools(patchBody.defaultTools) }
            : {}),
        };
        return await updateCustomAiPhase(pool, id, patch);
      } catch (err) {
        if (err instanceof DuplicateCustomPhaseError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );

  app.post(
    "/api/orgs/:orgId/users/me/custom-phases/:id/promote",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const result = await promoteCustomAiPhaseToOrg(pool, id, ctx.user.id);
      if (!result) return reply.code(404).send({ error: "Not found" });
      return result;
    },
  );

  app.delete(
    "/api/orgs/:orgId/users/me/custom-phases/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const existing = await getCustomAiPhase(pool, id);
      if (!existing || existing.orgId !== orgId || existing.userId !== ctx.user.id) {
        return reply.code(404).send({ error: "Not found" });
      }
      await deleteCustomAiPhase(pool, id);
      reply.code(204);
      return null;
    },
  );
}
