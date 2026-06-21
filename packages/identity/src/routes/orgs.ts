import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Role } from "@journeyman/core";
import { canAccessOrg } from "@journeyman/core";
import { makeRequireAuth } from "../middleware.ts";
import {
  countActiveAdminsInOrg, createInvite, deleteMembership, isOrgAdmin,
  listMembershipsForOrg, updateMembershipRole,
} from "../db.ts";

export async function registerOrgRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/memberships",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (!canAccessOrg(req.runContext!, orgId)) return reply.code(403).send({ error: "Wrong org" });
      return listMembershipsForOrg(pool, orgId);
    });

  app.post("/api/orgs/:orgId/invitations",
    { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "membership.invite", targetType: "membership" } } },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (!canAccessOrg(req.runContext!, orgId)) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { username?: string; role?: Role; tempPassword?: string; displayName?: string };
      if (!body?.username || !body?.role) return reply.code(400).send({ error: "Missing username or role" });
      if (body.role !== "admin" && body.role !== "member") return reply.code(400).send({ error: "Bad role" });

      const tempPassword = body.tempPassword ?? randomBytes(9).toString("base64url");
      const passwordHash = await bcrypt.hash(tempPassword, 12);
      const user = await createInvite(pool, {
        orgId, username: body.username, role: body.role, passwordHash, displayName: body.displayName,
      });
      req.auditTargetId = user.id;
      req.auditDetail = { username: body.username, role: body.role };
      reply.code(201);
      return { user, tempPassword };
    });

  app.delete("/api/orgs/:orgId/memberships/:userId",
    { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "membership.remove", targetType: "membership", idParam: "userId" } } },
    async (req, reply) => {
      const { orgId, userId } = req.params as { orgId: string; userId: string };
      if (!canAccessOrg(req.runContext!, orgId)) return reply.code(403).send({ error: "Wrong org" });
      if (await isOrgAdmin(pool, orgId, userId)) {
        const remaining = await countActiveAdminsInOrg(pool, orgId);
        if (remaining <= 1) return reply.code(409).send({ error: "Cannot remove last admin" });
      }
      await deleteMembership(pool, orgId, userId);
      return { ok: true };
    });

  app.patch("/api/orgs/:orgId/memberships/:userId",
    { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "membership.update_role", targetType: "membership", idParam: "userId" } } },
    async (req, reply) => {
      const { orgId, userId } = req.params as { orgId: string; userId: string };
      if (!canAccessOrg(req.runContext!, orgId)) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { role?: Role };
      if (body?.role !== "admin" && body?.role !== "member") return reply.code(400).send({ error: "Bad role" });
      if (body.role === "member" && await isOrgAdmin(pool, orgId, userId)) {
        const remaining = await countActiveAdminsInOrg(pool, orgId);
        if (remaining <= 1) return reply.code(409).send({ error: "Cannot demote last admin" });
      }
      await updateMembershipRole(pool, orgId, userId, body.role);
      req.auditDetail = { role: body.role };
      return { ok: true };
    });
}
