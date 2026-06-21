import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  insertSandbox, listSandboxes, getSandbox, updateSandbox, deleteSandbox, listVisibleSandboxes,
  applyImageStateOnSave, markImagePending,
} from "../db.ts";
import { validateSandboxInput, validateMaxConcurrentInstances, InvalidSandboxInputError } from "../sandbox-record.ts";
import { SANDBOX_CATALOG } from "../sandbox-catalog.ts";
import { runWorkerConnectionTest } from "../test-connection.ts";
import { makeDockerClient } from "../backends/docker/docker-client.ts";
import { makeWindowsAgentClient } from "../backends/windows/windows-agent-client.ts";

export async function registerSandboxRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const requireAuth = makeRequireAuth({ pool });

  // ---- Visible (system + org + user) ----
  app.get("/api/orgs/:orgId/sandboxes/visible", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    return listVisibleSandboxes(pool, orgId);
  });

  // ---- Capability catalog (all types; unbuilt ones flagged "planned") ----
  app.get("/api/orgs/:orgId/sandboxes/types", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    return SANDBOX_CATALOG;
  });

  // ---- Test connection for a candidate {type, config} ----
  app.post("/api/orgs/:orgId/sandboxes/test-connection", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as { type?: string; config?: Record<string, unknown> };
    if (!body?.type) return reply.code(400).send({ error: "type is required" });
    return runWorkerConnectionTest(
      { type: body.type as never, config: body.config ?? {} },
      { makeDockerClient, makeWindowsClient: makeWindowsAgentClient },
    );
  });

  // ---- Org-scoped CRUD ----
  app.get("/api/orgs/:orgId/sandboxes", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    return listSandboxes(pool, orgId);
  });

  app.post("/api/orgs/:orgId/sandboxes", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as any;
    try {
      validateSandboxInput(body);
      const rec = await insertSandbox(pool, {
        scope: "org", orgId, name: body.name, type: body.type,
        executionMode: body.executionMode, connectivity: body.connectivity ?? null,
        config: body.config ?? {}, tags: body.tags ?? [],
        enabled: body.enabled ?? true, createdBy: ctx.user.id,
        maxConcurrentInstances: body.maxConcurrentInstances ?? null,
      });
      await applyImageStateOnSave(pool, rec.id, rec.type, rec.config);
      reply.code(201);
      return rec;
    } catch (err) {
      if (err instanceof InvalidSandboxInputError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.get("/api/orgs/:orgId/sandboxes/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const rec = await getSandbox(pool, id, orgId);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    return rec;
  });

  app.patch("/api/orgs/:orgId/sandboxes/:id", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as any;
    try {
      validateMaxConcurrentInstances(body.maxConcurrentInstances);
    } catch (err) {
      if (err instanceof InvalidSandboxInputError) return reply.code(400).send({ error: err.message });
      throw err;
    }
    const ok = await updateSandbox(pool, {
      id, orgId, name: body.name, executionMode: body.executionMode,
      connectivity: body.connectivity, config: body.config,
      tags: body.tags, enabled: body.enabled,
      maxConcurrentInstances: body.maxConcurrentInstances,
    });
    if (!ok) return reply.code(404).send({ error: "Not found" });
    const rec = await getSandbox(pool, id, orgId);
    if (rec) await applyImageStateOnSave(pool, rec.id, rec.type, rec.config);
    return { ok: true };
  });

  // ---- Rebuild a target's managed image (force pending) ----
  app.post("/api/orgs/:orgId/sandboxes/:id/rebuild", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const rec = await getSandbox(pool, id, orgId);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    await markImagePending(pool, id);
    return { ok: true };
  });

  app.delete("/api/orgs/:orgId/sandboxes/:id", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const ok = await deleteSandbox(pool, id, orgId);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}
