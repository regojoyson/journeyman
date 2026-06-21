import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import { registerAnalyticsRoutes } from "./routes/index.ts";

export async function buildAnalyticsServer(pool: Pool): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(sensible);

  app.get("/healthz", async () => ({ ok: true }));
  await registerAnalyticsRoutes(app, pool);

  return app;
}
