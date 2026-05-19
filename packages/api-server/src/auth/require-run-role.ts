import type { FastifyReply, FastifyRequest } from "fastify";
import type { Composition } from "../composition.ts";
import {
  effectiveRole, hasAtLeast,
  type ActorContext, type WorkflowInstanceGrantRole,
} from "@journeyman/core";

export function makeRequireWorkflowInstanceRole(c: Composition) {
  return function requireWorkflowInstanceRole(required: WorkflowInstanceGrantRole) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.runContext;
      if (!ctx) { reply.code(401).send({ error: "no_run_context" }); return; }

      const actor: ActorContext = {
        userId: ctx.user.id,
        orgId: ctx.org.id,
        isPlatformAdmin: ctx.isPlatformAdmin,
        role: ctx.role,
      };

      const { id } = req.params as { id: string };
      const workflowInstance = await c.workflowInstances.getById(id);
      if (!workflowInstance) { reply.code(404).send({ error: "not_found" }); return; }

      if (actor.isPlatformAdmin) {
        (req as any).effectiveWorkflowInstanceRole = "owner" as WorkflowInstanceGrantRole;
        return;
      }

      const grants = await c.workflowInstanceGrants.listByInstance(id);
      const role = effectiveRole(actor, grants);
      if (!hasAtLeast(role, required)) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      (req as any).effectiveWorkflowInstanceRole = role;
    };
  };
}
