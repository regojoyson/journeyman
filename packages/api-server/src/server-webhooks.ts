import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import type { Composition } from "@journeyman/api-context";
import { registerHealthRoutes } from "@journeyman/api-app";
import { registerWebhookRoutes } from "@journeyman/api-webhooks";

export async function buildWebhookServer(c: Composition): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(sensible);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.code(400).send({ error: "bad_request", issues: err.issues });
      return;
    }
    reply.send(err);
  });

  registerHealthRoutes(app);     // GET /healthz for container probes
  registerWebhookRoutes(app, c); // POST /webhooks/in/:tenantToken
  return app;
}
