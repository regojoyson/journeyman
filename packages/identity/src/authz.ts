import type { FastifyRequest, FastifyReply } from "fastify";
import type {
  RunContext,
  WorkspacePermission,
  WorkspaceMemberLike,
  WorkspaceRole,
} from "@journeyman/core";
import { evaluateCan, resolvePermissions, roleGrants } from "@journeyman/core";
import type { Queryable } from "./db-workspaces.ts";

export interface WorkspaceAccess {
  orgId: string;
  isOrgAdmin: boolean;
  member: WorkspaceMemberLike | null;
}

/**
 * Single query: resolves the caller's org-admin status and workspace membership
 * for a given workspace. Returns null if the workspace does not exist.
 */
export async function loadWorkspaceAccess(
  db: Queryable,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceAccess | null> {
  const r = await db.query(
    `SELECT w.org_id            AS org_id,
            m.role              AS org_role,
            wm.role             AS ws_role,
            wm.permissions      AS ws_permissions
     FROM jm_workspaces w
     LEFT JOIN jm_memberships m       ON m.org_id = w.org_id AND m.user_id = $1
     LEFT JOIN jm_workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $1
     WHERE w.id = $2`,
    [userId, workspaceId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const member: WorkspaceMemberLike | null = row.ws_role
    ? { role: row.ws_role as WorkspaceRole, permissions: row.ws_permissions ?? null }
    : null;
  return { orgId: row.org_id, isOrgAdmin: row.org_role === "admin", member };
}

/** DB-backed access decision. Returns false if the workspace is missing. */
export async function can(
  db: Queryable,
  ctx: RunContext,
  workspaceId: string,
  permission: WorkspacePermission,
): Promise<boolean> {
  const access = await loadWorkspaceAccess(db, ctx.user.id, workspaceId);
  if (!access) return false;
  return evaluateCan(
    { isPlatformAdmin: ctx.isPlatformAdmin, isOrgAdmin: access.isOrgAdmin, member: access.member },
    permission,
  );
}

export interface AuthzDeps {
  pool: Queryable;
}

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * Guard factory. `requireWorkspacePermission(perm)` returns a preHandler that:
 *  - requires requireAuth to have already populated req.runContext
 *  - reads :wsId, 404s if the workspace is missing
 *  - 403s if the caller lacks `perm`
 *  - otherwise attaches the resolved workspace to req.runContext.workspace
 */
export function makeRequireWorkspacePermission(deps: AuthzDeps) {
  return (permission: WorkspacePermission): PreHandler => {
    return async (req, reply) => {
      const ctx = req.runContext;
      if (!ctx) {
        await reply.code(401).send({ error: "unauthorized" });
        return;
      }
      const wsId = (req.params as { wsId?: string }).wsId;
      if (!wsId) {
        await reply.code(400).send({ error: "missing workspace id" });
        return;
      }
      const access = await loadWorkspaceAccess(deps.pool, ctx.user.id, wsId);
      if (!access) {
        await reply.code(404).send({ error: "workspace not found" });
        return;
      }
      const allowed = evaluateCan(
        { isPlatformAdmin: ctx.isPlatformAdmin, isOrgAdmin: access.isOrgAdmin, member: access.member },
        permission,
      );
      if (!allowed) {
        await reply.code(403).send({ error: "forbidden" });
        return;
      }
      const permissions = ctx.isPlatformAdmin || access.isOrgAdmin
        ? [...roleGrants("maintainer")]
        : access.member
          ? [...resolvePermissions(access.member)]
          : [];
      ctx.workspace = {
        id: wsId,
        orgId: access.orgId,
        role: access.member?.role ?? null,
        permissions,
      };
    };
  };
}

/**
 * Org-level guard. `requireOrgRole('admin')` returns a preHandler that allows
 * platform admins and org admins of the context org through, else 403s.
 * If the route has an :orgId param, it must match the context org.
 */
export function makeRequireOrgRole(_deps: AuthzDeps) {
  return (role: "admin"): PreHandler => {
    return async (req, reply) => {
      const ctx = req.runContext;
      if (!ctx) {
        await reply.code(401).send({ error: "unauthorized" });
        return;
      }
      const orgId = (req.params as { orgId?: string }).orgId;
      if (orgId && orgId !== ctx.org.id && !ctx.isPlatformAdmin) {
        await reply.code(403).send({ error: "forbidden" });
        return;
      }
      if (!ctx.isPlatformAdmin && !(role === "admin" && ctx.role === "admin")) {
        await reply.code(403).send({ error: "forbidden" });
        return;
      }
    };
  };
}
