import type { FastifyInstance } from "fastify";
import { SKILL_CATALOG } from "../catalog.ts";

export async function registerSkillCatalogRoute(app: FastifyInstance) {
  app.get("/api/skill-catalog", async () => SKILL_CATALOG);
}
