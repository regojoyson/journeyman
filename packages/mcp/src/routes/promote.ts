import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { fetchPinnedOrgSecret } from "@journeyman/secrets/db";
import { readGlobalSecrets } from "@journeyman/secrets";
import {
  DuplicateMcpInstanceError,
  InvalidMcpInputError,
  getUserMcpInstanceById,
  promoteToOrg,
} from "../db.ts";
import type { McpBinding } from "@journeyman/core";

export async function registerPromoteMcpRoute(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.post(
    "/api/orgs/:orgId/mcp-instances/:userInstanceId/promote",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, userInstanceId } = req.params as { orgId: string; userInstanceId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });

      const orig = await getUserMcpInstanceById(pool, userInstanceId, orgId);
      if (!orig) return reply.code(404).send({ error: "Not found" });

      const body = req.body as {
        name?: string;
        description?: string | null;
        systemPrompt?: string | null;
        bindings?: McpBinding[];
        enabled?: boolean;
      };

      const bindings = Array.isArray(body.bindings) ? body.bindings : [];

      const globalNames = new Set(Object.keys(readGlobalSecrets()));
      const unresolved: string[] = [];
      for (const b of bindings) {
        if (globalNames.has(b.secretName)) continue;
        const orgVal = await fetchPinnedOrgSecret(pool, orgId, b.secretName);
        if (orgVal === null) unresolved.push(b.secretName);
      }
      if (unresolved.length > 0) {
        return reply.code(400).send({
          error: `secrets not in org/global scope: ${unresolved.join(", ")}`,
          unresolved,
        });
      }

      try {
        const rec = await promoteToOrg(pool, {
          userInstanceId,
          orgId,
          name: body.name ?? orig.name,
          description: body.description ?? orig.description,
          systemPrompt: body.systemPrompt ?? orig.systemPrompt,
          bindings,
          enabled: body.enabled ?? orig.enabled,
          promotedBy: ctx.user.id,
        });
        reply.code(201);
        return rec;
      } catch (err) {
        if (err instanceof DuplicateMcpInstanceError) return reply.code(409).send({ error: err.message });
        if (err instanceof InvalidMcpInputError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );
}
