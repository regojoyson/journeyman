import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerWorkspaceSkillRoutes } from "./workspace-skills.ts";
import { registerSkillCatalogRoute } from "./catalog.ts";

export async function registerSkillRoutes(app: FastifyInstance, pool: Pool) {
  await registerWorkspaceSkillRoutes(app, pool);
  await registerSkillCatalogRoute(app);
}
