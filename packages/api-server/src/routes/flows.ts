import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { createFlowBody } from "../schemas/flow.ts";
import { createRunBody } from "../schemas/run.ts";
import { updateFlowBody } from "../schemas/update-flow.ts";
import { cloneFlowBody } from "../schemas/clone-flow.ts";
import { promoteFlowBody } from "../schemas/promote-flow.ts";
import type { FlowGraph, FlowScope } from "@journeyman/core";
import { makeRequireAuth } from "@journeyman/identity";
import {
  canCreateAtScope, canDelete, canEdit, canPromoteTo, canRead,
  type Caller,
} from "../services/flow-access.ts";

function callerFromCtx(ctx: NonNullable<import("fastify").FastifyRequest["runContext"]>): Caller {
  return {
    userId: ctx.user.id,
    orgId: ctx.org.id,
    role: ctx.role,
    isPlatformAdmin: ctx.isPlatformAdmin,
  };
}

export function registerFlowRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });

  app.post("/flows", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    const caller = callerFromCtx(ctx);
    const body = createFlowBody.parse(req.body);

    if (!canCreateAtScope(body.scope as FlowScope, caller)) {
      reply.code(403); return { error: "forbidden" };
    }

    const orgId =
      body.scope === "user"   ? caller.orgId :
      body.scope === "org"    ? (body.orgId ?? caller.orgId) :
      /* global */              null;

    if (body.scope === "org" && orgId !== caller.orgId) {
      reply.code(403); return { error: "cannot_create_flow_in_other_org" };
    }

    const ownerUserId = body.scope === "user" ? caller.userId : null;

    const { flow, version } = await c.flows.create({
      scope: body.scope as FlowScope,
      name: body.name,
      description: body.description,
      orgId,
      ownerUserId,
      initialDefinition: body.definition as FlowGraph,
      createdByUserId: caller.userId,
    });
    reply.code(201);
    return { flow, version };
  });

  app.get("/flows", { preHandler: requireAuth() }, async (req) => {
    const ctx = req.runContext!;
    const q = req.query as { scope?: string; orgId?: string; limit?: string };
    const flows = await c.flows.list({
      callerUserId: ctx.user.id,
      callerOrgId: ctx.org.id,
      callerIsPlatformAdmin: ctx.isPlatformAdmin,
      callerIsOrgAdmin: ctx.role === "admin",
      scope: q.scope as FlowScope | undefined,
      orgId: q.orgId,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return { flows };
  });

  app.get("/flows/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(flow, caller)) { reply.code(403); return { error: "forbidden" }; }
    return { flow };
  });

  app.put("/flows/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = updateFlowBody.parse(req.body);

    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canEdit(flow, caller)) { reply.code(403); return { error: "forbidden" }; }

    if (body.name !== undefined || body.description !== undefined) {
      await c.flows.updateMeta(id, { name: body.name, description: body.description });
    }
    let newVersion = null;
    if (body.definition) {
      newVersion = await c.flowVersions.appendVersion({
        flowId: id, definition: body.definition as FlowGraph, createdByUserId: caller.userId,
      });
    }
    const updated = await c.flows.getById(id);
    return { flow: updated, version: newVersion };
  });

  app.delete("/flows/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canDelete(flow, caller)) { reply.code(403); return { error: "forbidden" }; }
    await c.flows.delete(id);
    reply.code(204).send();
  });

  app.get("/flows/:id/versions/current", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(flow, caller)) { reply.code(403); return { error: "forbidden" }; }
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
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = createRunBody.parse(req.body);

    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(flow, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!flow.currentVersionId) { reply.code(409); return { error: "flow_has_no_versions" }; }
    const version = await c.flowVersions.getById(flow.currentVersionId);
    if (!version) { reply.code(500); return { error: "version_missing" }; }

    const { runId, engineWorkflowId } = await c.orchestrator.submit({
      flowId: flow.id,
      flowVersionId: version.id,
      flowNameSnapshot: flow.name,
      flowScopeSnapshot: flow.scope,
      definitionSnapshot: version.definition,
      inputs: body.inputs,
      startedByUserId: caller.userId,
      startedByOrgId: ctx.org.id,
    });

    reply.code(202);
    return { runId, engineWorkflowId };
  });

  // ----- Snapshot actions -----

  app.post("/flows/:id/clone", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = cloneFlowBody.parse(req.body ?? {});
    const src = await c.flows.getById(id);
    if (!src) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(src, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!src.currentVersionId) { reply.code(409); return { error: "flow_has_no_versions" }; }
    const ver = await c.flowVersions.getById(src.currentVersionId);
    if (!ver) { reply.code(500); return { error: "version_missing" }; }

    const { flow } = await c.flows.create({
      scope: "user",
      name: body.name ?? `${src.name} (copy)`,
      description: src.description ?? undefined,
      orgId: caller.orgId,
      ownerUserId: caller.userId,
      initialDefinition: ver.definition,
      createdByUserId: caller.userId,
    });
    reply.code(201);
    return { id: flow.id };
  });

  app.post("/flows/:id/promote", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = promoteFlowBody.parse(req.body);
    const src = await c.flows.getById(id);
    if (!src) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(src, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!canPromoteTo(body.targetScope, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!src.currentVersionId) { reply.code(409); return { error: "flow_has_no_versions" }; }
    const ver = await c.flowVersions.getById(src.currentVersionId);
    if (!ver) { reply.code(500); return { error: "version_missing" }; }

    const orgId =
      body.targetScope === "org"
        ? (body.orgId ?? src.orgId ?? caller.orgId)
        : null;

    if (body.targetScope === "org" && !caller.isPlatformAdmin && orgId !== caller.orgId) {
      reply.code(403); return { error: "cannot_promote_to_other_org" };
    }

    const { flow } = await c.flows.create({
      scope: body.targetScope,
      name: body.name ?? src.name,
      description: src.description ?? undefined,
      orgId,
      ownerUserId: null,
      initialDefinition: ver.definition,
      createdByUserId: caller.userId,
    });
    reply.code(201);
    return { id: flow.id };
  });
}
