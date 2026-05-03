import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerUserSkillRoutes } from "./user-skills.ts";
import { registerOrgSkillRoutes } from "./org-skills.ts";
import { registerSkillCatalogRoute } from "./catalog.ts";

export async function registerSkillRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgSkillRoutes(app, pool);
  await registerUserSkillRoutes(app, pool);
  await registerSkillCatalogRoute(app);
}
