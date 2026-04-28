import type { FastifyInstance } from "fastify";
import { phaseCatalog } from "@journeyman/phases/catalog";

export function registerPhasesRoutes(app: FastifyInstance): void {
  app.get("/phases", async () => {
    return { phases: phaseCatalog };
  });
}
