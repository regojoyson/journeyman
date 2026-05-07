import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { makeRequireAuth } from "@journeyman/identity";
import { canDelete, canRead } from "../services/flow-access.ts";

export function registerWorkflowGrantsRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });

  app.get("/workflows/:id/grants", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    const { id } = req.params as { id: string };
    const workflow = await c.workflows.getById(id);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(workflow, {
      userId: ctx.user.id, orgId: ctx.org.id, role: ctx.role, isPlatformAdmin: ctx.isPlatformAdmin,
    })) { reply.code(403); return { error: "forbidden" }; }
    return { grants: await c.workflowGrants.listByWorkflow(id) };
  });

  app.post("/workflows/:id/grants", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    const { id } = req.params as { id: string };
    const workflow = await c.workflows.getById(id);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    if (!canDelete(workflow, {
      userId: ctx.user.id, orgId: ctx.org.id, role: ctx.role, isPlatformAdmin: ctx.isPlatformAdmin,
    })) { reply.code(403); return { error: "forbidden" }; }

    const body = req.body as {
      principalType?: "user" | "org" | "global";
      principalId?: string | null;
      role?: "owner" | "editor" | "viewer";
    };
    if (!body?.principalType || !body?.role) { reply.code(400); return { error: "bad_request" }; }
    if (body.role === "owner") { reply.code(409); return { error: "owner_grants_immutable_in_this_version" }; }

    const grant = await c.workflowGrants.create({
      workflowId: id,
      principalType: body.principalType,
      principalId: body.principalType === "global" ? null : (body.principalId ?? null),
      role: body.role,
      createdBy: ctx.user.id,
    });
    reply.code(201);
    return { grant };
  });

  app.delete("/workflows/:id/grants/:grantId", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    const { id, grantId } = req.params as { id: string; grantId: string };
    const workflow = await c.workflows.getById(id);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    if (!canDelete(workflow, {
      userId: ctx.user.id, orgId: ctx.org.id, role: ctx.role, isPlatformAdmin: ctx.isPlatformAdmin,
    })) { reply.code(403); return { error: "forbidden" }; }

    const grants = await c.workflowGrants.listByWorkflow(id);
    const target = grants.find(g => g.id === grantId);
    if (!target) { reply.code(404); return { error: "not_found" }; }
    if (target.role === "owner") { reply.code(409); return { error: "cannot_delete_owner_grant" }; }
    await c.workflowGrants.delete(grantId);
    reply.code(204).send();
  });
}
