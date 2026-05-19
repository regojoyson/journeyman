import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { rmSync } from "node:fs";
import {
  DuplicateSkillPackageError,
  countRowsByLocalPath,
  deleteSkillPackage,
  findShareableSkillPackage,
  getSkillPackage,
  insertSkillPackage,
  listSkillPackages,
  updateEnabledSkills,
} from "../db.ts";
import { discoverSkills, runInstall } from "../installer.ts";

export async function registerUserSkillRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/orgs/:orgId/users/me/skill-packages",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listSkillPackages(pool, orgId, ctx.user.id);
    },
  );

  app.post(
    "/api/orgs/:orgId/users/me/skill-packages",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as any;
      try {
        const rec = await insertSkillPackage(pool, {
          orgId,
          userId: ctx.user.id,
          scope: "user",
          gitUrl: body.gitUrl,
          name: body.name,
          cliType: body.cliType ?? "claude",
          shareCloneWith: body.shareCloneWith ?? undefined,
        });
        if (!body.shareCloneWith) {
          void runInstall(pool, rec.id, rec.name, rec.gitUrl, undefined);
        }
        reply.code(201);
        return rec;
      } catch (err) {
        if (err instanceof DuplicateSkillPackageError)
          return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );

  app.get(
    "/api/orgs/:orgId/users/me/skill-packages/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rec = await getSkillPackage(pool, id, orgId, ctx.user.id);
      if (!rec) return reply.code(404).send({ error: "Not found" });
      return rec;
    },
  );

  app.delete(
    "/api/orgs/:orgId/users/me/skill-packages/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rec = await getSkillPackage(pool, id, orgId, ctx.user.id);
      if (!rec) return reply.code(404).send({ error: "Not found" });
      const ok = await deleteSkillPackage(pool, id, orgId, ctx.user.id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      if (rec.localPath) {
        const remaining = await countRowsByLocalPath(pool, rec.localPath);
        if (remaining === 0) {
          try { rmSync(rec.localPath, { recursive: true, force: true }); } catch { /* ignore */ }
        }
      }
      return { ok: true };
    },
  );

  app.put(
    "/api/orgs/:orgId/users/me/skill-packages/:id/enabled-skills",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as any;
      const ok = await updateEnabledSkills(pool, id, orgId, ctx.user.id, body.enabledSkills ?? []);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    },
  );

  app.get(
    "/api/orgs/:orgId/users/me/skill-packages/:id/skills",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rec = await getSkillPackage(pool, id, orgId, ctx.user.id);
      if (!rec) return reply.code(404).send({ error: "Not found" });
      if (!rec.localPath) return [];
      return discoverSkills(rec.localPath);
    },
  );

  app.post(
    "/api/orgs/:orgId/users/me/skill-packages/:id/pull",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rec = await getSkillPackage(pool, id, orgId, ctx.user.id);
      if (!rec) return reply.code(404).send({ error: "Not found" });
      void runInstall(pool, rec.id, rec.name, rec.gitUrl, rec.localPath);
      return { ok: true };
    },
  );

  app.get(
    "/api/orgs/:orgId/users/me/skill-packages/by-url",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const { url } = req.query as { url?: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      if (!url) return reply.code(400).send({ error: "Missing url query param" });
      const rec = await findShareableSkillPackage(pool, orgId, ctx.user.id, url);
      if (!rec) return reply.code(404).send({ error: "Not found" });
      return rec;
    },
  );
}
