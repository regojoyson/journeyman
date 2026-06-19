import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { roleGrants, resolvePermissions } from "@journeyman/core";
import { makeRequireAuth } from "../middleware.ts";
import { listWorkspacesForUser, listWorkspacesForOrg } from "../db-workspaces.ts";

export async function registerWorkspaceRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

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
}
