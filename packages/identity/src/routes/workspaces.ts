import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { roleGrants, resolvePermissions } from "@journeyman/core";
import { makeRequireAuth } from "../middleware.ts";
import { makeRequireWorkspacePermission } from "../authz.ts";
import {
  listWorkspacesForUser,
  listWorkspacesForOrg,
  listWorkspaceMembersWithUsers,
  slugifyWorkspaceName,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  getWorkspaceMember,
  upsertWorkspaceMember,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from "../db-workspaces.ts";

const WORKSPACE_ROLES = ["maintainer", "contributor", "observer"] as const;
function isRole(v: unknown): v is (typeof WORKSPACE_ROLES)[number] {
  return typeof v === "string" && (WORKSPACE_ROLES as readonly string[]).includes(v);
}

export async function registerWorkspaceRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });
  const requirePerm = makeRequireWorkspacePermission({ pool });

  // List the caller's workspaces in their active org, annotated with effective
  // role + permissions. Org admins / platform admins see ALL org workspaces with
  // full (maintainer) permissions even without an explicit membership row.
  app.get("/api/workspaces", { preHandler: requireAuth() }, async (req) => {
    const ctx = req.runContext!;
    const orgId = ctx.org.id;
    const isAdmin = ctx.isPlatformAdmin || ctx.role === "admin";

    if (isAdmin) {
      const all = await listWorkspacesForOrg(pool, orgId);
      const perms = [...roleGrants("maintainer")];
      return {
        workspaces: all.map((w) => ({
          id: w.id, orgId: w.orgId, name: w.name, slug: w.slug,
          role: "maintainer" as const, permissions: perms,
        })),
      };
    }

    const mine = await listWorkspacesForUser(pool, orgId, ctx.user.id);
    return {
      workspaces: mine.map((w) => ({
        id: w.id, orgId: w.orgId, name: w.name, slug: w.slug,
        role: w.role,
        permissions: [...resolvePermissions({ role: w.role, permissions: null })],
      })),
    };
  });

  // --- Org-admin: list / create / delete workspaces ---
  app.get("/api/orgs/:orgId/workspaces", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });
    return { workspaces: await listWorkspacesForOrg(pool, orgId) };
  });

  app.post("/api/orgs/:orgId/workspaces", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });
    const body = req.body as { name?: string; slug?: string };
    if (!body?.name?.trim()) return reply.code(400).send({ error: "missing_name" });
    const slug = body.slug?.trim() || slugifyWorkspaceName(body.name);
    try {
      const ws = await createWorkspace(pool, { orgId, slug, name: body.name.trim() });
      // creator becomes a maintainer member so the workspace appears in their switcher
      await upsertWorkspaceMember(pool, { workspaceId: ws.id, userId: req.runContext!.user.id, role: "maintainer" });
      reply.code(201);
      return ws;
    } catch (err: any) {
      if (err?.code === "23505") return reply.code(409).send({ error: "slug_exists" });
      throw err;
    }
  });

  app.delete("/api/orgs/:orgId/workspaces/:wsId", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId, wsId } = req.params as { orgId: string; wsId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });
    const ws = await getWorkspace(pool, wsId);
    if (!ws || ws.orgId !== orgId) return reply.code(404).send({ error: "not_found" });
    if (ws.slug === "default") return reply.code(409).send({ error: "cannot_delete_default" });
    await deleteWorkspace(pool, wsId, orgId);
    return { ok: true };
  });

  // --- Member management (members.manage = maintainer / org admin / platform admin) ---
  app.get("/api/workspaces/:wsId/members", { preHandler: [requireAuth(), requirePerm("members.manage")] }, async (req) => {
    const { wsId } = req.params as { wsId: string };
    return { members: await listWorkspaceMembersWithUsers(pool, wsId) };
  });

  app.post("/api/workspaces/:wsId/members", { preHandler: [requireAuth(), requirePerm("members.manage")] }, async (req, reply) => {
    const { wsId } = req.params as { wsId: string };
    const body = req.body as { userId?: string; role?: string };
    if (!body?.userId || !isRole(body.role)) return reply.code(400).send({ error: "bad_request" });
    const member = await upsertWorkspaceMember(pool, { workspaceId: wsId, userId: body.userId, role: body.role });
    reply.code(201);
    return member;
  });

  app.patch("/api/workspaces/:wsId/members/:userId", { preHandler: [requireAuth(), requirePerm("members.manage")] }, async (req, reply) => {
    const { wsId, userId } = req.params as { wsId: string; userId: string };
    const body = req.body as { role?: string };
    if (!isRole(body.role)) return reply.code(400).send({ error: "bad_role" });
    const existing = await getWorkspaceMember(pool, wsId, userId);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    await updateWorkspaceMemberRole(pool, wsId, userId, body.role);
    return { ok: true };
  });

  app.delete("/api/workspaces/:wsId/members/:userId", { preHandler: [requireAuth(), requirePerm("members.manage")] }, async (req) => {
    const { wsId, userId } = req.params as { wsId: string; userId: string };
    await removeWorkspaceMember(pool, wsId, userId);
    return { ok: true };
  });
}
