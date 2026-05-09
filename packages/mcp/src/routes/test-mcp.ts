import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { testMcpInstance, type TestAction } from "../test-runner.ts";

function parseAction(body: unknown): TestAction | { error: string } {
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

export async function registerMcpTestRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.post(
    "/api/orgs/:orgId/users/me/mcp-instances/:id/test",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });

      const parsed = parseAction(req.body);
      if ("error" in parsed) return reply.code(400).send({ error: parsed.error });

      const out = await testMcpInstance(pool, { orgId, userId: ctx.user.id }, id, parsed);
      return out;
    },
  );

  app.post(
    "/api/orgs/:orgId/mcp-instances/:id/test",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });

      const parsed = parseAction(req.body);
      if ("error" in parsed) return reply.code(400).send({ error: parsed.error });

      const out = await testMcpInstance(pool, { orgId, userId: ctx.user.id }, id, parsed);
      return out;
    },
  );
}
