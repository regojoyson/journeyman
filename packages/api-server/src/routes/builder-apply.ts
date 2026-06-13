import type { FastifyInstance } from "fastify";
import { makeRequireAuth } from "@journeyman/identity";
import { insertCustomAiStep, deleteCustomAiStep } from "@journeyman/custom-steps";
import {
  applyBuildPlan, buildApplyArgs, requiredGapsRemaining,
  getBuilderSession, updateBuilderSession, type ApplyDeps,
} from "@journeyman/builder";
import type { Composition } from "../composition.ts";

/** Build the executor's injected deps from the live composition. */
function makeApplyDeps(c: Composition): ApplyDeps {
  const pool = c.pool!;
  return {
    insertStep: async (input) => {
      const created = await insertCustomAiStep(pool, input);
      return { id: created.id };
    },
    deleteStep: async (id) => { await deleteCustomAiStep(pool, id); },
    createWorkflow: async (args) => {
      const { workflow, version } = await c.workflows.create(args);
      return { workflowId: workflow.id, versionId: version.id };
    },
  };
}

export function registerBuilderApplyRoute(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });

  app.post("/orgs/:orgId/users/me/builder/sessions/:id/apply",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });

      const session = await getBuilderSession(c.pool!, id, orgId, ctx.user.id);
      if (!session) return reply.code(404).send({ error: "Not found" });
      if (!session.buildPlan) return reply.code(400).send({ error: "Session has no build plan to apply" });
      if (requiredGapsRemaining(session.buildPlan)) {
        return reply.code(409).send({ error: "Resolve all required gaps before applying" });
      }

      const args = buildApplyArgs(session, { orgId, userId: ctx.user.id });
      const result = await applyBuildPlan(makeApplyDeps(c), args);

      await updateBuilderSession(c.pool!, {
        id, orgId, userId: ctx.user.id,
        status: "applied", appliedFlowId: result.workflowId,
      });

      reply.code(201);
      return { workflowId: result.workflowId, versionId: result.versionId };
    });
}
