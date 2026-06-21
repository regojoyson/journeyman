import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import type { Composition } from "@journeyman/api-context";
import { audit, buildAuditEntry } from "@journeyman/api-context";
import {
  registerHealthRoutes, registerWorkflowRoutes, registerAgentRoutes,
  registerConnectionRoutes, registerWorkflowInstanceRoutes, registerUsageRoutes,
  registerHumanTaskRoutes, registerFormRoutes, registerStepsRoutes,
  registerAgentTriggerRoutes, registerWorkflowTriggersRoute,
  registerBuilderApplyRoute, registerBuilderChatRoute,
} from "@journeyman/api-http";
import { registerWebhookManagementRoutes, registerWebhookPresetRoutes } from "@journeyman/api-webhooks";
import { registerIdentityRoutes } from "@journeyman/identity";
import { registerSecretsRoutes } from "@journeyman/secrets";
import { registerMcpRoutes } from "@journeyman/mcp";
import { registerBuilderRoutes } from "@journeyman/builder";
import { registerSandboxRoutes, registerSandboxInstanceRoutes } from "@journeyman/sandbox";
import { registerSkillRoutes } from "@journeyman/skills";
import { registerCustomStepRoutes } from "@journeyman/custom-steps";
import { registerCodingModelRoutes } from "@journeyman/coding-models";

export async function buildHttpServer(c: Composition): Promise<FastifyInstance> {
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

  // Central audit trail: any route that declares `config.audit` gets one
  // jm_audit_log row on a successful (2xx) authenticated response. Registered
  // before route plugins so it applies to every encapsulated context too.
  if (c.pool) {
    const pool = c.pool;
    app.addHook("onResponse", async (req, reply) => {
      const tag = (req.routeOptions?.config as
        | { audit?: { action: string; targetType: string; idParam?: string } }
        | undefined)?.audit;
      const entry = buildAuditEntry({
        statusCode: reply.statusCode,
        tag,
        runContext: req.runContext,
        params: (req.params ?? {}) as Record<string, unknown>,
        explicitTargetId: req.auditTargetId ?? null,
        detail: req.auditDetail,
      });
      if (entry) await audit(pool, entry);
    });
  }

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
    // connections routes use `/workspaces/:wsId/connections` paths (no inline /api),
    // so they must be mounted under the /api prefix like the workflow routes below.
    await app.register(async (s) => registerConnectionRoutes(s, c), { prefix: "/api" });
    registerAgentTriggerRoutes(app, c);
    // Webhook management/presets are authenticated UI routes under /api/... — they
    // ride on the HTTP service (the public receiver is isolated in api-webhooks).
    registerWebhookPresetRoutes(app, c);
  }
  registerStepsRoutes(app);
  if (c.pool) registerWebhookManagementRoutes(app, c);
  // Namespace under /api so the single nginx `/api/` proxy reaches them and they
  // don't collide with the SPA's page routes. Auth is a per-route preHandler.
  await app.register(async (s) => {
    registerWorkflowRoutes(s, c);
    registerWorkflowInstanceRoutes(s, c);
    registerUsageRoutes(s, c);
    registerHumanTaskRoutes(s, c);
    registerFormRoutes(s, c);
    registerWorkflowTriggersRoute(s, c);
    registerBuilderApplyRoute(s, c);
    registerBuilderChatRoute(s, c);
  }, { prefix: "/api" });

  return app;
}
