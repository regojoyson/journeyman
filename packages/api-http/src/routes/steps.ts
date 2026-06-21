import type { FastifyInstance } from "fastify";
import { stepCatalog } from "@journeyman/steps/catalog";

export function registerStepsRoutes(app: FastifyInstance): void {
  app.get("/api/steps", async () => {
    return { steps: stepCatalog };
  });
}
