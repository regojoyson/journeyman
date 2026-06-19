import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import {
  DuplicateMcpInstanceError,
  InvalidMcpInputError,
  deleteMcpInstance,
  getMcpInstance,
  insertMcpInstance,
  listMcpInstances,
  listVisibleMcpInstances,
  updateMcpInstance,
} from "../db.ts";
import { testMcpInstance } from "../test-runner.ts";

function parseAction(body: unknown): { kind: "list" } | { kind: "invoke"; tool: string; args: Record<string, unknown> } | { error: string } {
  if (!body || typeof body !== "object") return { error: "body required" };
  const b = body as any;
  if (b.action === "list") return { kind: "list" };
  if (b.action === "invoke") {
    if (typeof b.tool !== "string" || !b.tool) return { error: "invoke requires tool (string)" };
    const args = b.args ?? {};
    if (typeof args !== "object" || Array.isArray(args)) {
      return { error: "invoke requires args (object)" };
    }
    return { kind: "invoke", tool: b.tool, args: args as Record<string, unknown> };
  }
  return { error: "action must be 'list' or 'invoke'" };
}

export async function registerWorkspaceMcpRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });
  const requirePerm = makeRequireWorkspacePermission({ pool });
  const read = { preHandler: [requireAuth(), requirePerm("resource.read")] };
  const write = { preHandler: [requireAuth(), requirePerm("resource.write")] };
  const del = { preHandler: [requireAuth(), requirePerm("resource.delete")] };

  app.get("/api/workspaces/:wsId/mcp-instances", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    return listMcpInstances(pool, wsId);
  });

  app.post("/api/workspaces/:wsId/mcp-instances", write, async (req, reply) => {
    const { wsId } = req.params as { wsId: string };
    const ctx = req.runContext!;
    const body = req.body as any;
    try {
      const rec = await insertMcpInstance(pool, {
        workspaceId: wsId,
        name: body.name,
        description: body.description ?? null,
        transport: body.transport,
        command: body.command ?? null,
        args: body.args ?? null,
        url: body.url ?? null,
        bindings: body.bindings ?? [],
        systemPrompt: body.systemPrompt ?? null,
        enabled: body.enabled ?? true,
        createdBy: ctx.user.id,
      });
      reply.code(201);
      return rec;
    } catch (err) {
      if (err instanceof DuplicateMcpInstanceError) return reply.code(409).send({ error: err.message });
      if (err instanceof InvalidMcpInputError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.get("/api/workspaces/:wsId/mcp-instances/visible", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    return listVisibleMcpInstances(pool, wsId);
  });

  app.get("/api/workspaces/:wsId/mcp-instances/:id", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const rec = await getMcpInstance(pool, id, wsId);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    return rec;
  });

  app.patch("/api/workspaces/:wsId/mcp-instances/:id", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const body = req.body as any;
    try {
      const ok = await updateMcpInstance(pool, {
        id, workspaceId: wsId,
        description: body.description,
        command: body.command,
        args: body.args,
        url: body.url,
        bindings: body.bindings,
        systemPrompt: body.systemPrompt,
        enabled: body.enabled,
      });
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    } catch (err) {
      if (err instanceof InvalidMcpInputError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.delete("/api/workspaces/:wsId/mcp-instances/:id", del, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const ok = await deleteMcpInstance(pool, id, wsId);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.post("/api/workspaces/:wsId/mcp-instances/:id/test", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const parsed = parseAction(req.body);
    if ("error" in parsed) return reply.code(400).send({ error: parsed.error });
    const out = await testMcpInstance(pool, { workspaceId: wsId }, id, parsed);
    return out;
  });
}
