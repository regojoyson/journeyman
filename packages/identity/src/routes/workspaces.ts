import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { roleGrants } from "@journeyman/core";
import { makeRequireAuth } from "../middleware.ts";
import {
  listWorkspacesForOrg,
  slugifyWorkspaceName,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  updateWorkspace,
} from "../db-workspaces.ts";

export async function registerWorkspaceRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

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
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });
    return { workspaces: await listWorkspacesForOrg(pool, orgId) };
  });

  app.post("/api/orgs/:orgId/workspaces", { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "workspace.create", targetType: "workspace" } } }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });
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
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });
    const ws = await getWorkspace(pool, wsId);
    if (!ws || ws.orgId !== orgId) return reply.code(404).send({ error: "not_found" });
    return ws;
  });

  app.patch("/api/orgs/:orgId/workspaces/:wsId", { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "workspace.update", targetType: "workspace", idParam: "wsId" } } }, async (req, reply) => {
    const { orgId, wsId } = req.params as { orgId: string; wsId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });
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
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });
    const ws = await getWorkspace(pool, wsId);
    if (!ws || ws.orgId !== orgId) return reply.code(404).send({ error: "not_found" });
    if (ws.slug === "default") return reply.code(409).send({ error: "cannot_delete_default" });
    await deleteWorkspace(pool, wsId, orgId);
    return { ok: true };
  });
}
