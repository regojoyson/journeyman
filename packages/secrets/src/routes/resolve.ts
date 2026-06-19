import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { MissingSecretsError } from "@journeyman/core";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import { resolveSecrets } from "../resolver.ts";

export async function registerResolveRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });
  const requirePerm = makeRequireWorkspacePermission({ pool });

  app.get("/api/workspaces/:wsId/secrets/_resolve",
    { preHandler: [requireAuth(), requirePerm("resource.read")] },
    async (req) => {
      const ctx = req.runContext!;
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
