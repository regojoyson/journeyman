import bcrypt from "bcrypt";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "../middleware.ts";
import { getUserPasswordHash, updateUserPassword, updateUserProfile } from "../db.ts";

export async function registerUserRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.post("/api/users/me/password",
    { preHandler: requireAuth(), config: { audit: { action: "user.change_password", targetType: "user" } } },
    async (req, reply) => {
      const ctx = req.runContext!;
      req.auditTargetId = ctx.user.id;
      const body = req.body as { currentPassword?: string; newPassword?: string };
      if (!body?.currentPassword || !body?.newPassword) {
        return reply.code(400).send({ error: "Missing fields" });
      }
      const hash = await getUserPasswordHash(pool, ctx.user.id);
      if (!hash || !(await bcrypt.compare(body.currentPassword, hash))) {
        return reply.code(401).send({ error: "Wrong current password" });
      }
      await updateUserPassword(pool, ctx.user.id, await bcrypt.hash(body.newPassword, 12));
      return { ok: true };
    });

  app.patch("/api/users/me",
    { preHandler: requireAuth(), config: { audit: { action: "user.update_self", targetType: "user" } } },
    async (req) => {
      const ctx = req.runContext!;
      req.auditTargetId = ctx.user.id;
      const body = req.body as { displayName?: string | null };
      await updateUserProfile(pool, ctx.user.id, body?.displayName ?? null);
      return { ok: true };
    });
}
