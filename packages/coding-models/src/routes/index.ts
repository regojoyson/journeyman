import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerOrgCodingModelRoutes } from "./org.ts";
import { registerPublicCodingModelRoutes } from "./public.ts";

export async function registerCodingModelRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgCodingModelRoutes(app, pool);
  await registerPublicCodingModelRoutes(app, pool);
}
