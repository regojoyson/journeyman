import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import type { Composition } from "./composition.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerWorkflowRoutes } from "./routes/flows.ts";
import { registerAgentRoutes } from "./routes/agents.ts";
import { registerConnectionRoutes } from "./routes/connections.ts";
import { registerAgentTriggerRoutes } from "./routes/agent-triggers.ts";
import { startAgentScheduler } from "./services/agent-scheduler.ts";
import { registerStepsRoutes } from "./routes/steps.ts";
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
import { registerBuilderRoutes } from "@journeyman/builder";
import { registerBuilderApplyRoute } from "./routes/builder-apply.ts";
import { registerBuilderChatRoute } from "./routes/builder-chat.ts";
import { registerSandboxRoutes, registerSandboxInstanceRoutes } from "@journeyman/sandbox";
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
    await registerBuilderRoutes(app, c.pool);
    await registerSandboxRoutes(app, c.pool);
    if (c.sandboxInstanceRoutesDeps) await registerSandboxInstanceRoutes(app, c.pool, c.sandboxInstanceRoutesDeps);
    await registerSkillRoutes(app, c.pool);
    await registerCustomStepRoutes(app, c.pool);
    await registerCodingModelRoutes(app, c.pool);
    registerAgentRoutes(app, c);
    registerConnectionRoutes(app, c);
    registerAgentTriggerRoutes(app, c);
  }
  registerStepsRoutes(app);
  registerWebhookRoutes(app, c);
  if (c.pool) {
    registerWebhookManagementRoutes(app, c);
    registerWebhookPresetRoutes(app, c);
  }
  // These registrars historically registered at root (/workflows, /workflow-instances,
  // …). Namespace them under /api so the single nginx `/api/` proxy reaches them and they
  // don't collide with the SPA's /workflows & /workflow-instances page routes. Auth is a
  // per-route preHandler (reads token from request headers; closured pool), so this
  // encapsulation does not change auth/role/ownership behavior.
  await app.register(async (s) => {
    registerWorkflowRoutes(s, c);
    registerWorkflowInstanceRoutes(s, c);
    registerHumanTaskRoutes(s, c);
    registerFormRoutes(s, c);
    registerWorkflowTriggersRoute(s, c);
    registerBuilderApplyRoute(s, c);
    registerBuilderChatRoute(s, c);
  }, { prefix: "/api" });

  // Phase 3: fire scheduled agents from the api-server process (it holds the orchestrator).
  if (c.pool) startAgentScheduler(c.pool, { orchestrator: c.orchestrator });

  return app;
}
