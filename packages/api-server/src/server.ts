import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import type { Composition } from "./composition.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerFlowRoutes } from "./routes/flows.ts";
import { registerRunRoutes } from "./routes/runs.ts";
import { registerIdentityRoutes } from "@journeyman/identity";

export async function buildServer(c: Composition): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: true });
  await app.register(sensible);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.code(400).send({ error: "bad_request", issues: err.issues });
      return;
    }
    reply.send(err);
  });

  registerHealthRoutes(app);
  await registerIdentityRoutes(app, c.pool!);
  registerFlowRoutes(app, c);
  registerRunRoutes(app, c);
  return app;
}
