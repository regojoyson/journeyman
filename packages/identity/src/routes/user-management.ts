import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "../middleware.ts";
import {
  adminUpdateUserProfile, countActiveAdminsInOrg, findMembership, isOrgAdmin,
  listUsersInOrg, setUserStatus, updateUserPassword,
} from "../db.ts";

export async function registerUserManagementRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/users",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listUsersInOrg(pool, orgId);
    });

  app.patch("/api/orgs/:orgId/users/:userId/status",
    { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "user.update_status", targetType: "user", idParam: "userId" } } },
    async (req, reply) => {
      const { orgId, userId } = req.params as { orgId: string; userId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      if (ctx.user.id === userId) return reply.code(400).send({ error: "Cannot change your own status" });
      const body = req.body as { status?: "active" | "disabled" };
      if (body?.status !== "active" && body?.status !== "disabled") {
        return reply.code(400).send({ error: "Bad status" });
      }
      const m = await findMembership(pool, userId, orgId);
      if (!m) return reply.code(404).send({ error: "Not a member" });
      if (body.status === "disabled" && await isOrgAdmin(pool, orgId, userId)) {
        const remaining = await countActiveAdminsInOrg(pool, orgId);
        if (remaining <= 1) return reply.code(409).send({ error: "Cannot disable last admin" });
      }
      await setUserStatus(pool, userId, body.status);
      return { ok: true };
    });

  app.post("/api/orgs/:orgId/users/:userId/reset-password",
    { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "user.reset_password", targetType: "user", idParam: "userId" } } },
    async (req, reply) => {
      const { orgId, userId } = req.params as { orgId: string; userId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      if (ctx.user.id === userId) return reply.code(400).send({ error: "Use self-service to change your own password" });
      const m = await findMembership(pool, userId, orgId);
      if (!m) return reply.code(404).send({ error: "Not a member" });
      const body = (req.body ?? {}) as { tempPassword?: string };
      const tempPassword = body.tempPassword ?? randomBytes(9).toString("base64url");
      await updateUserPassword(pool, userId, await bcrypt.hash(tempPassword, 12));
      return { tempPassword };
    });

  app.patch("/api/orgs/:orgId/users/:userId/profile",
    { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "user.update_profile", targetType: "user", idParam: "userId" } } },
    async (req, reply) => {
      const { orgId, userId } = req.params as { orgId: string; userId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const m = await findMembership(pool, userId, orgId);
      if (!m) return reply.code(404).send({ error: "Not a member" });
      const body = req.body as { displayName?: string | null };
      await adminUpdateUserProfile(pool, userId, body?.displayName ?? null);
      return { ok: true };
    });
}
