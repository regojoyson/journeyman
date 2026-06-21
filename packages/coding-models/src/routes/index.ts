import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerOrgCodingModelRoutes } from "./org.ts";
import { registerPublicCodingModelRoutes } from "./public.ts";
import { registerOrgModelPricingRoutes } from "./pricing.ts";

export async function registerCodingModelRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgCodingModelRoutes(app, pool);
  await registerPublicCodingModelRoutes(app, pool);
  await registerOrgModelPricingRoutes(app, pool);
}
