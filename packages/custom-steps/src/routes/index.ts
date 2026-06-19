import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerWorkspaceCustomStepRoutes } from "./workspace-custom-steps.ts";

export async function registerCustomStepRoutes(app: FastifyInstance, pool: Pool) {
  await registerWorkspaceCustomStepRoutes(app, pool);
}
