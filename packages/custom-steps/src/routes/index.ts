import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerUserCustomStepRoutes } from "./user-custom-steps.ts";
import { registerOrgCustomStepRoutes } from "./org-custom-steps.ts";
import { registerVisibleCustomStepRoutes } from "./visible.ts";

export async function registerCustomStepRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgCustomStepRoutes(app, pool);
  await registerUserCustomStepRoutes(app, pool);
  await registerVisibleCustomStepRoutes(app, pool);
}
