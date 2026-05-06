import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerUserCustomPhaseRoutes } from "./user-custom-phases.ts";
import { registerOrgCustomPhaseRoutes } from "./org-custom-phases.ts";
import { registerVisibleCustomPhaseRoutes } from "./visible.ts";

export async function registerCustomPhaseRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgCustomPhaseRoutes(app, pool);
  await registerUserCustomPhaseRoutes(app, pool);
  await registerVisibleCustomPhaseRoutes(app, pool);
}
