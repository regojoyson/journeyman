import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  insertSandbox, listSandboxes, getSandbox, updateSandbox, deleteSandbox, listVisibleSandboxes,
  applyImageStateOnSave, markImagePending,
} from "../db.ts";
import { validateSandboxInput, InvalidSandboxInputError } from "../sandbox-record.ts";
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
    return listVisibleSandboxes(pool, orgId, ctx.user.id);
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
    return listSandboxes(pool, { orgId, userId: null });
  });

  app.post("/api/orgs/:orgId/sandboxes", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as any;
    try {
      validateSandboxInput(body);
      const rec = await insertSandbox(pool, {
        scope: "org", orgId, userId: null, name: body.name, type: body.type,
        executionMode: body.executionMode, connectivity: body.connectivity ?? null,
        config: body.config ?? {}, tags: body.tags ?? [],
        enabled: body.enabled ?? true, createdBy: ctx.user.id,
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
    const rec = await getSandbox(pool, id, orgId, null);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    return rec;
  });

  app.patch("/api/orgs/:orgId/sandboxes/:id", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as any;
    const ok = await updateSandbox(pool, {
      id, orgId, userId: null, name: body.name, executionMode: body.executionMode,
      connectivity: body.connectivity, config: body.config,
      tags: body.tags, enabled: body.enabled,
    });
    if (!ok) return reply.code(404).send({ error: "Not found" });
    const rec = await getSandbox(pool, id, orgId, null);
    if (rec) await applyImageStateOnSave(pool, rec.id, rec.type, rec.config);
    return { ok: true };
  });

  // ---- Rebuild a target's managed image (force pending) ----
  app.post("/api/orgs/:orgId/sandboxes/:id/rebuild", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const rec = await getSandbox(pool, id, orgId, null);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    await markImagePending(pool, id);
    return { ok: true };
  });

  app.delete("/api/orgs/:orgId/sandboxes/:id", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const ok = await deleteSandbox(pool, id, orgId, null);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  // ---- User-scoped CRUD ----
  app.get("/api/orgs/:orgId/users/me/sandboxes", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    return listSandboxes(pool, { orgId, userId: ctx.user.id });
  });

  app.post("/api/orgs/:orgId/users/me/sandboxes", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as any;
    try {
      validateSandboxInput(body);
      const rec = await insertSandbox(pool, {
        scope: "user", orgId, userId: ctx.user.id, name: body.name, type: body.type,
        executionMode: body.executionMode, connectivity: body.connectivity ?? null,
        config: body.config ?? {}, tags: body.tags ?? [],
        enabled: body.enabled ?? true, createdBy: ctx.user.id,
      });
      await applyImageStateOnSave(pool, rec.id, rec.type, rec.config);
      reply.code(201);
      return rec;
    } catch (err) {
      if (err instanceof InvalidSandboxInputError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.patch("/api/orgs/:orgId/users/me/sandboxes/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as any;
    const ok = await updateSandbox(pool, {
      id, orgId, userId: ctx.user.id, name: body.name, executionMode: body.executionMode,
      connectivity: body.connectivity, config: body.config,
      tags: body.tags, enabled: body.enabled,
    });
    if (!ok) return reply.code(404).send({ error: "Not found" });
    const rec = await getSandbox(pool, id, orgId, ctx.user.id);
    if (rec) await applyImageStateOnSave(pool, rec.id, rec.type, rec.config);
    return { ok: true };
  });

  app.post("/api/orgs/:orgId/users/me/sandboxes/:id/rebuild", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const rec = await getSandbox(pool, id, orgId, ctx.user.id);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    await markImagePending(pool, id);
    return { ok: true };
  });

  app.delete("/api/orgs/:orgId/users/me/sandboxes/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const ok = await deleteSandbox(pool, id, orgId, ctx.user.id);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}
