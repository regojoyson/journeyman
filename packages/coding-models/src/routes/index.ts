import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerAdminCodingModelRoutes } from "./admin.ts";
import { registerPublicCodingModelRoutes } from "./public.ts";

export async function registerCodingModelRoutes(app: FastifyInstance, pool: Pool) {
  await registerAdminCodingModelRoutes(app, pool);
  await registerPublicCodingModelRoutes(app, pool);
}
