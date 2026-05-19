import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { MissingSecretsError } from "@journeyman/core";
import { makeRequireAuth } from "@journeyman/identity";
import { resolveSecrets } from "../resolver.ts";

export async function registerResolveRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/secrets/_resolve",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const q = (req.query as { names?: string }).names ?? "";
      const names = q.split(",").map(s => s.trim()).filter(Boolean);
      const out: Record<string, string | null> = {};
      for (const n of names) out[n] = null;
      if (names.length === 0) return out;
      await Promise.all(names.map(async n => {
        try {
          const r = await resolveSecrets({ pool, ctx, names: [n] });
          out[n] = r.values[n] ?? null;
        } catch (err) {
          if (err instanceof MissingSecretsError) out[n] = null;
          else throw err;
        }
      }));
      return out;
    });
}
