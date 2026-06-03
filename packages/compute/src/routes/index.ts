import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  insertComputeTarget, listComputeTargets, getComputeTarget, updateComputeTarget, deleteComputeTarget, listVisibleComputeTargets,
} from "../db.ts";
import { validateComputeTargetInput, InvalidComputeTargetInputError } from "../compute-target-record.ts";
import { COMPUTE_TARGET_CATALOG } from "../compute-target-catalog.ts";
import { runWorkerConnectionTest } from "../test-connection.ts";
import { makeDockerClient } from "../backends/docker/docker-client.ts";

export async function registerWorkerRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const requireAuth = makeRequireAuth({ pool });

  // ---- Visible (system + org + user) ----
  app.get("/api/orgs/:orgId/workers/visible", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    return listVisibleComputeTargets(pool, orgId, ctx.user.id);
  });

  // ---- Capability catalog (all types; unbuilt ones flagged "planned") ----
  app.get("/api/orgs/:orgId/workers/types", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    return COMPUTE_TARGET_CATALOG;
  });

  // ---- Test connection for a candidate {type, config} ----
  app.post("/api/orgs/:orgId/workers/test-connection", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as { type?: string; config?: Record<string, unknown> };
    if (!body?.type) return reply.code(400).send({ error: "type is required" });
    return runWorkerConnectionTest(
      { type: body.type as never, config: body.config ?? {} },
      { makeDockerClient },
    );
  });

  // ---- Org-scoped CRUD ----
  app.get("/api/orgs/:orgId/workers", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    return listComputeTargets(pool, { orgId, userId: null });
  });

  app.post("/api/orgs/:orgId/workers", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as any;
    try {
      validateComputeTargetInput(body);
      const rec = await insertComputeTarget(pool, {
        scope: "org", orgId, userId: null, name: body.name, type: body.type,
        executionMode: body.executionMode, connectivity: body.connectivity ?? null,
        config: body.config ?? {}, isDefault: body.isDefault ?? false, tags: body.tags ?? [],
        enabled: body.enabled ?? true, createdBy: ctx.user.id,
      });
      reply.code(201);
      return rec;
    } catch (err) {
      if (err instanceof InvalidComputeTargetInputError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.get("/api/orgs/:orgId/workers/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const rec = await getComputeTarget(pool, id, orgId, null);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    return rec;
  });

  app.patch("/api/orgs/:orgId/workers/:id", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as any;
    const ok = await updateComputeTarget(pool, {
      id, orgId, userId: null, name: body.name, executionMode: body.executionMode,
      connectivity: body.connectivity, config: body.config, isDefault: body.isDefault,
      tags: body.tags, enabled: body.enabled,
    });
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.delete("/api/orgs/:orgId/workers/:id", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const ok = await deleteComputeTarget(pool, id, orgId, null);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  // ---- User-scoped CRUD ----
  app.get("/api/orgs/:orgId/users/me/workers", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    return listComputeTargets(pool, { orgId, userId: ctx.user.id });
  });

  app.post("/api/orgs/:orgId/users/me/workers", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as any;
    try {
      validateComputeTargetInput(body);
      const rec = await insertComputeTarget(pool, {
        scope: "user", orgId, userId: ctx.user.id, name: body.name, type: body.type,
        executionMode: body.executionMode, connectivity: body.connectivity ?? null,
        config: body.config ?? {}, isDefault: body.isDefault ?? false, tags: body.tags ?? [],
        enabled: body.enabled ?? true, createdBy: ctx.user.id,
      });
      reply.code(201);
      return rec;
    } catch (err) {
      if (err instanceof InvalidComputeTargetInputError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.patch("/api/orgs/:orgId/users/me/workers/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as any;
    const ok = await updateComputeTarget(pool, {
      id, orgId, userId: ctx.user.id, name: body.name, executionMode: body.executionMode,
      connectivity: body.connectivity, config: body.config, isDefault: body.isDefault,
      tags: body.tags, enabled: body.enabled,
    });
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.delete("/api/orgs/:orgId/users/me/workers/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const ok = await deleteComputeTarget(pool, id, orgId, ctx.user.id);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}
