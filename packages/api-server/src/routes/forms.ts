import type { FastifyInstance } from "fastify";
import { makeRequireAuth } from "@journeyman/identity";
import type { Composition } from "../composition.ts";
import { resolveFormSchema, submitForm } from "../services/form-submission.ts";

export function registerFormRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });

  // Inventory: every published, visible workflow with a trigger-human node.
  // TODO(forms phase 3): accept ?workspace_id= query param to list forms across
  // workspace. For now, requires a workspace context from requireWorkspacePermission.
  app.get("/me/forms", { preHandler: requireAuth() }, async (req) => {
    const ctx = req.runContext!;
    const workspaceId = ctx.workspace?.id;
    if (!workspaceId) return { forms: [] };

    const workflows = await c.workflows.list({ workspaceId });

    const out: Array<{ workflowId: string; name: string; title: string }> = [];
    for (const wf of workflows) {
      if (wf.status !== "ready" || !wf.currentVersionId) continue;
      const v = await c.workflowVersions.getById(wf.currentVersionId);
      if (!v) continue;
      const schema = resolveFormSchema(wf, v);
      if (!schema) continue;
      out.push({ workflowId: wf.id, name: wf.name, title: schema.title });
    }
    return { forms: out };
  });

  app.get("/workflows/:id/form", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const wf = await c.workflows.getById(id);
    if (!wf) { reply.code(404); return { error: "not_found" }; }
    if (wf.status !== "ready" || !wf.currentVersionId) {
      reply.code(409); return { error: "workflow_not_ready" };
    }
    const v = await c.workflowVersions.getById(wf.currentVersionId);
    if (!v) { reply.code(500); return { error: "version_missing" }; }
    const schema = resolveFormSchema(wf, v);
    if (!schema) { reply.code(404); return { error: "no_human_trigger" }; }
    return { form: schema };
  });

  app.post("/workflows/:id/form-submissions", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { values?: Record<string, unknown> };
    const ctx = req.runContext!;

    const wf = await c.workflows.getById(id);
    if (!wf) { reply.code(404); return { error: "not_found" }; }
    if (wf.status !== "ready" || !wf.currentVersionId) {
      reply.code(409); return { error: "workflow_not_ready" };
    }
    const v = await c.workflowVersions.getById(wf.currentVersionId);
    if (!v) { reply.code(500); return { error: "version_missing" }; }

    try {
      const result = await submitForm(c, c.pool, {
        workflow: wf,
        version: v,
        submittedByUserId: ctx.user.id,
        startedByOrgId: ctx.org.id,
        values: body.values ?? {},
      });
      reply.code(202);
      return result;
    } catch (e) {
      reply.code(400);
      return { error: "invalid_submission", reason: (e as Error).message };
    }
  });
}
