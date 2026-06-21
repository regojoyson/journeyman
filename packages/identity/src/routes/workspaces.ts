import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { roleGrants, canAccessOrg } from "@journeyman/core";
import { makeRequireAuth } from "../middleware.ts";
import {
  listWorkspacesForOrg,
  slugifyWorkspaceName,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  updateWorkspace,
  upsertWorkspaceMember,
  getWorkspaceMember,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  listWorkspaceMembersPage,
  listAddableOrgMembers,
} from "../db-workspaces.ts";
import type { WorkspaceRole } from "@journeyman/core";

export async function registerWorkspaceRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  const WORKSPACE_ROLES: WorkspaceRole[] = ["maintainer", "contributor", "observer"];
  const isWorkspaceRole = (v: unknown): v is WorkspaceRole =>
    typeof v === "string" && (WORKSPACE_ROLES as string[]).includes(v);

  // Validates :orgId is accessible to the caller and the workspace exists under it.
  async function loadOrgWorkspace(req: any, reply: any) {
    const { orgId, wsId } = req.params as { orgId: string; wsId: string };
    if (!canAccessOrg(req.runContext!, orgId)) { reply.code(403).send({ error: "wrong_org" }); return null; }
    const ws = await getWorkspace(pool, wsId);
    if (!ws || ws.orgId !== orgId) { reply.code(404).send({ error: "not_found" }); return null; }
    return ws;
  }

  // All org members see all org workspaces. Admins get maintainer; everyone else gets contributor.
  app.get("/api/workspaces", { preHandler: requireAuth() }, async (req) => {
    const ctx = req.runContext!;
    const orgId = ctx.org.id;
    const isAdmin = ctx.isPlatformAdmin || ctx.role === "admin";
    const all = await listWorkspacesForOrg(pool, orgId);

    if (isAdmin) {
      const perms = [...roleGrants("maintainer")];
      return {
        workspaces: all.map((w) => ({
          id: w.id, orgId: w.orgId, name: w.name, slug: w.slug,
          role: "maintainer" as const, permissions: perms,
        })),
      };
    }

    const perms = [...roleGrants("contributor")];
    return {
      workspaces: all.map((w) => ({
        id: w.id, orgId: w.orgId, name: w.name, slug: w.slug,
        role: "contributor" as const, permissions: perms,
      })),
    };
  });

  // --- Org-admin: list / create / get / update / delete workspaces ---
  app.get("/api/orgs/:orgId/workspaces", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (!canAccessOrg(req.runContext!, orgId)) return reply.code(403).send({ error: "wrong_org" });
    return { workspaces: await listWorkspacesForOrg(pool, orgId) };
  });

  app.post("/api/orgs/:orgId/workspaces", { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "workspace.create", targetType: "workspace" } } }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (!canAccessOrg(req.runContext!, orgId)) return reply.code(403).send({ error: "wrong_org" });
    const body = req.body as { name?: string; slug?: string };
    if (!body?.name?.trim()) return reply.code(400).send({ error: "missing_name" });
    const slug = body.slug?.trim() || slugifyWorkspaceName(body.name);
    try {
      const ws = await createWorkspace(pool, { orgId, slug, name: body.name.trim() });
      req.auditTargetId = ws.id;
      req.auditDetail = { name: ws.name, slug: ws.slug };
      reply.code(201);
      return ws;
    } catch (err: any) {
      if (err?.code === "23505") return reply.code(409).send({ error: "slug_exists" });
      throw err;
    }
  });

  app.get("/api/orgs/:orgId/workspaces/:wsId", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId, wsId } = req.params as { orgId: string; wsId: string };
    if (!canAccessOrg(req.runContext!, orgId)) return reply.code(403).send({ error: "wrong_org" });
    const ws = await getWorkspace(pool, wsId);
    if (!ws || ws.orgId !== orgId) return reply.code(404).send({ error: "not_found" });
    return ws;
  });

  app.patch("/api/orgs/:orgId/workspaces/:wsId", { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "workspace.update", targetType: "workspace", idParam: "wsId" } } }, async (req, reply) => {
    const { orgId, wsId } = req.params as { orgId: string; wsId: string };
    if (!canAccessOrg(req.runContext!, orgId)) return reply.code(403).send({ error: "wrong_org" });
    const body = req.body as { name?: string; slug?: string };
    if (!body?.name?.trim()) return reply.code(400).send({ error: "missing_name" });
    const existing = await getWorkspace(pool, wsId);
    if (!existing || existing.orgId !== orgId) return reply.code(404).send({ error: "not_found" });
    const slug = body.slug?.trim() || slugifyWorkspaceName(body.name);
    try {
      const ws = await updateWorkspace(pool, { workspaceId: wsId, orgId, name: body.name.trim(), slug });
      if (!ws) return reply.code(404).send({ error: "not_found" });
      return ws;
    } catch (err: any) {
      if (err?.code === "23505") return reply.code(409).send({ error: "slug_exists" });
      throw err;
    }
  });

  app.delete("/api/orgs/:orgId/workspaces/:wsId", { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "workspace.delete", targetType: "workspace", idParam: "wsId" } } }, async (req, reply) => {
    const { orgId, wsId } = req.params as { orgId: string; wsId: string };
    if (!canAccessOrg(req.runContext!, orgId)) return reply.code(403).send({ error: "wrong_org" });
    const ws = await getWorkspace(pool, wsId);
    if (!ws || ws.orgId !== orgId) return reply.code(404).send({ error: "not_found" });
    if (ws.slug === "default") return reply.code(409).send({ error: "cannot_delete_default" });
    await deleteWorkspace(pool, wsId, orgId);
    return { ok: true };
  });

  // --- Workspace members (org-admin only) ---

  // List members, paginated.
  app.get("/api/orgs/:orgId/workspaces/:wsId/members", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const ws = await loadOrgWorkspace(req, reply);
    if (!ws) return;
    const qs = req.query as { page?: string; limit?: string };
    const page = Math.max(1, Number(qs.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(qs.limit) || 20));
    const { items, total } = await listWorkspaceMembersPage(pool, ws.id, { limit, offset: (page - 1) * limit });
    return { items, total, page, limit };
  });

  // Org members not yet in the workspace, for the associate picker.
  app.get("/api/orgs/:orgId/workspaces/:wsId/addable-members", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const ws = await loadOrgWorkspace(req, reply);
    if (!ws) return;
    const { q } = req.query as { q?: string };
    return { items: await listAddableOrgMembers(pool, ws.orgId, ws.id, q) };
  });

  // Associate a user with a workspace role.
  app.post("/api/orgs/:orgId/workspaces/:wsId/members", {
    preHandler: requireAuth({ role: "admin" }),
    config: { audit: { action: "workspace.member.add", targetType: "workspace_member", idParam: "wsId" } },
  }, async (req, reply) => {
    const ws = await loadOrgWorkspace(req, reply);
    if (!ws) return;
    const body = req.body as { userId?: string; role?: string };
    if (!body?.userId) return reply.code(400).send({ error: "missing_user" });
    if (!isWorkspaceRole(body.role)) return reply.code(400).send({ error: "invalid_role" });
    const inOrg = await pool.query("SELECT 1 FROM jm_memberships WHERE org_id = $1 AND user_id = $2", [ws.orgId, body.userId]);
    if (inOrg.rowCount === 0) return reply.code(400).send({ error: "not_org_member" });
    const rec = await upsertWorkspaceMember(pool, { workspaceId: ws.id, userId: body.userId, role: body.role });
    req.auditDetail = { userId: body.userId, role: body.role };
    reply.code(201);
    return { userId: rec.userId, role: rec.role };
  });

  // Update a member's workspace role.
  app.patch("/api/orgs/:orgId/workspaces/:wsId/members/:userId", {
    preHandler: requireAuth({ role: "admin" }),
    config: { audit: { action: "workspace.member.update_role", targetType: "workspace_member", idParam: "userId" } },
  }, async (req, reply) => {
    const ws = await loadOrgWorkspace(req, reply);
    if (!ws) return;
    const { userId } = req.params as { userId: string };
    const body = req.body as { role?: string };
    if (!isWorkspaceRole(body?.role)) return reply.code(400).send({ error: "invalid_role" });
    const existing = await getWorkspaceMember(pool, ws.id, userId);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    await updateWorkspaceMemberRole(pool, ws.id, userId, body.role);
    req.auditDetail = { role: body.role };
    return { ok: true };
  });

  // Remove a member.
  app.delete("/api/orgs/:orgId/workspaces/:wsId/members/:userId", {
    preHandler: requireAuth({ role: "admin" }),
    config: { audit: { action: "workspace.member.remove", targetType: "workspace_member", idParam: "userId" } },
  }, async (req, reply) => {
    const ws = await loadOrgWorkspace(req, reply);
    if (!ws) return;
    const { userId } = req.params as { userId: string };
    await removeWorkspaceMember(pool, ws.id, userId);
    return { ok: true };
  });
}
