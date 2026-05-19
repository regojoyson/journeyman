import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { listGlobalSecretNames } from "../global.ts";

export async function registerGlobalSecretRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/global-secrets",
    { preHandler: requireAuth({ role: "admin" }) },
    async () => listGlobalSecretNames().map(name => ({ name, source: "env" as const })));
}
