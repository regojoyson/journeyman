import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { createFlowBody } from "../schemas/flow.ts";
import { createRunBody } from "../schemas/run.ts";
import { updateFlowBody } from "../schemas/update-flow.ts";
import type { FlowGraph } from "@journeyman/core";
import { makeRequireAuth } from "@journeyman/identity";

export function registerFlowRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });

  app.post("/flows", { preHandler: requireAuth() }, async (req, reply) => {
    const body = createFlowBody.parse(req.body);
    const user = await c.auth.authenticate(req);
    const { flow, version } = await c.flows.create({
      name: body.name,
      description: body.description,
      ownerUserId: body.ownerUserId ?? user.userId,
      initialDefinition: body.definition as FlowGraph,
      createdByUserId: user.userId,
    });
    reply.code(201);
    return { flow, version };
  });

  app.get("/flows", { preHandler: requireAuth() }, async (req) => {
    const q = req.query as { ownerUserId?: string; limit?: string };
    const ownerUserId = q.ownerUserId === undefined
      ? undefined
      : (q.ownerUserId === "" ? null : q.ownerUserId);
    const limit = q.limit ? Number(q.limit) : undefined;
    const flows = await c.flows.list({ ownerUserId, limit });
    return { flows };
  });

  app.get("/flows/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    return { flow };
  });

  app.put("/flows/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateFlowBody.parse(req.body);
    const user = await c.auth.authenticate(req);

    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }

    let newVersion = null;
    if (body.definition) {
      newVersion = await c.flowVersions.appendVersion({
        flowId: id,
        definition: body.definition as FlowGraph,
        createdByUserId: user.userId,
      });
    }

    const updated = await c.flows.getById(id);
    return { flow: updated, version: newVersion };
  });

  app.get("/flows/:id/versions/current", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!flow.currentVersionId) { reply.code(409); return { error: "flow_has_no_versions" }; }
    const version = await c.flowVersions.getById(flow.currentVersionId);
    if (!version) { reply.code(500); return { error: "version_missing" }; }
    return { version };
  });

  app.get("/flow_versions/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const version = await c.flowVersions.getById(id);
    if (!version) { reply.code(404); return { error: "not_found" }; }
    return { version };
  });

  app.post("/flows/:id/runs", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = createRunBody.parse(req.body);
    const user = await c.auth.authenticate(req);

    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!flow.currentVersionId) {
      reply.code(409); return { error: "flow_has_no_versions" };
    }
    const version = await c.flowVersions.getById(flow.currentVersionId);
    if (!version) { reply.code(500); return { error: "version_missing" }; }

    const { runId, engineWorkflowId } = await c.orchestrator.submit({
      flowVersionId: version.id,
      flowDefinition: version.definition,
      inputs: body.inputs,
      startedByUserId: user.userId,
    });

    reply.code(202);
    return { runId, engineWorkflowId };
  });
}
