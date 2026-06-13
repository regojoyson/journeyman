import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerBuilderSessionRoutes } from "./sessions.ts";

export async function registerBuilderRoutes(app: FastifyInstance, pool: Pool) {
  await registerBuilderSessionRoutes(app, pool);
}
