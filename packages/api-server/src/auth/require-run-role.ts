import type { FastifyReply, FastifyRequest } from "fastify";
import type { Composition } from "../composition.ts";
import {
  effectiveRole, hasAtLeast,
  type ActorContext, type RunGrantRole,
} from "@journeyman/core";

export function makeRequireRunRole(c: Composition) {
  return function requireRunRole(required: RunGrantRole) {
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
      const run = await c.runs.getById(id);
      if (!run) { reply.code(404).send({ error: "not_found" }); return; }

      if (actor.isPlatformAdmin) {
        (req as any).effectiveRunRole = "owner" as RunGrantRole;
        return;
      }

      const grants = await c.runGrants.listByRun(id);
      const role = effectiveRole(actor, grants);
      if (!hasAtLeast(role, required)) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      (req as any).effectiveRunRole = role;
    };
  };
}
