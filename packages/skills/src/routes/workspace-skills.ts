import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import { rmSync } from "node:fs";
import {
  DuplicateSkillPackageError,
  countRowsByLocalPath,
  deleteSkillPackage,
  findShareableSkillPackage,
  getSkillPackage,
  insertSkillPackage,
  listSkillPackages,
  listVisibleSkillPackages,
  updateEnabledSkills,
} from "../db.ts";
import { discoverSkills, runInstall } from "../installer.ts";

export async function registerWorkspaceSkillRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });
  const requirePerm = makeRequireWorkspacePermission({ pool });
  const read = { preHandler: [requireAuth(), requirePerm("resource.read")] };
  const write = { preHandler: [requireAuth(), requirePerm("resource.write")] };
  const del = { preHandler: [requireAuth(), requirePerm("resource.delete")] };

  app.get("/api/workspaces/:wsId/skill-packages", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    return listSkillPackages(pool, wsId);
  });

  app.post("/api/workspaces/:wsId/skill-packages", { ...write, config: { audit: { action: "skill.install", targetType: "skill_package" } } }, async (req, reply) => {
    const { wsId } = req.params as { wsId: string };
    const body = req.body as any;
    try {
      const rec = await insertSkillPackage(pool, {
        workspaceId: wsId,
        gitUrl: body.gitUrl,
        name: body.name,
        cliType: body.cliType ?? "claude",
        shareCloneWith: body.shareCloneWith ?? undefined,
      });
      if (!body.shareCloneWith) void runInstall(pool, rec.id, rec.name, rec.gitUrl, undefined);
      req.auditTargetId = rec.id;
      req.auditDetail = { name: rec.name };
      reply.code(201);
      return rec;
    } catch (err) {
      if (err instanceof DuplicateSkillPackageError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  app.get("/api/workspaces/:wsId/skill-packages/by-url", read, async (req, reply) => {
    const { wsId } = req.params as { wsId: string };
    const { url } = req.query as { url?: string };
    if (!url) return reply.code(400).send({ error: "Missing url query param" });
    const rec = await findShareableSkillPackage(pool, wsId, url);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    return rec;
  });

  app.get("/api/workspaces/:wsId/skill-packages/visible", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    return listVisibleSkillPackages(pool, wsId);
  });

  app.get("/api/workspaces/:wsId/skill-packages/:id", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const rec = await getSkillPackage(pool, id, wsId);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    return rec;
  });

  app.delete("/api/workspaces/:wsId/skill-packages/:id", { ...del, config: { audit: { action: "skill.uninstall", targetType: "skill_package" } } }, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const rec = await getSkillPackage(pool, id, wsId);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    const ok = await deleteSkillPackage(pool, id, wsId);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    if (rec.localPath) {
      const remaining = await countRowsByLocalPath(pool, rec.localPath);
      if (remaining === 0) {
        try { rmSync(rec.localPath, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
    return { ok: true };
  });

  app.put("/api/workspaces/:wsId/skill-packages/:id/enabled-skills", { ...write, config: { audit: { action: "skill.update_enabled", targetType: "skill_package" } } }, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const body = req.body as any;
    const ok = await updateEnabledSkills(pool, id, wsId, body.enabledSkills ?? []);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.get("/api/workspaces/:wsId/skill-packages/:id/skills", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const rec = await getSkillPackage(pool, id, wsId);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    if (!rec.localPath) return [];
    return discoverSkills(rec.localPath);
  });

  app.post("/api/workspaces/:wsId/skill-packages/:id/pull", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const rec = await getSkillPackage(pool, id, wsId);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    void runInstall(pool, rec.id, rec.name, rec.gitUrl, rec.localPath);
    return { ok: true };
  });
}
