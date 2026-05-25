import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import type { Composition } from "./composition.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerWorkflowRoutes } from "./routes/flows.ts";
import { registerStepsRoutes } from "./routes/steps.ts";
import { registerWorkflowGrantsRoutes } from "./routes/flow-grants.ts";
import { registerWorkflowInstanceRoutes } from "./routes/workflow-instances.ts";
import { registerWebhookRoutes } from "./routes/webhooks.ts";
import { registerWebhookManagementRoutes } from "./routes/webhooks-management.ts";
import { registerWebhookPresetRoutes } from "./routes/webhook-presets.ts";
import { registerHumanTaskRoutes } from "./routes/human-tasks.ts";
import { registerFormRoutes } from "./routes/forms.ts";
import { registerWorkflowTriggersRoute } from "./routes/workflow-triggers.ts";
import { registerIdentityRoutes } from "@journeyman/identity";
import { registerSecretsRoutes } from "@journeyman/secrets";
import { registerMcpRoutes } from "@journeyman/mcp";
import { registerSkillRoutes } from "@journeyman/skills";
import { registerCustomStepRoutes } from "@journeyman/custom-steps";
import { registerCodingModelRoutes } from "@journeyman/coding-models";

export async function buildServer(c: Composition): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: true, credentials: true });
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
  if (c.pool) {
    await registerSecretsRoutes(app, c.pool);
    await registerMcpRoutes(app, c.pool);
    await registerSkillRoutes(app, c.pool);
    await registerCustomStepRoutes(app, c.pool);
    await registerCodingModelRoutes(app, c.pool);
  }
  registerWorkflowRoutes(app, c);
  registerStepsRoutes(app);
  registerWorkflowGrantsRoutes(app, c);
  registerWorkflowInstanceRoutes(app, c);
  registerWebhookRoutes(app, c);
  if (c.pool) {
    registerWebhookManagementRoutes(app, c);
    registerWebhookPresetRoutes(app, c);
  }
  registerHumanTaskRoutes(app, c);
  registerFormRoutes(app, c);
  registerWorkflowTriggersRoute(app, c);
  return app;
}
