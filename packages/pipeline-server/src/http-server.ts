/**
 * @file http-server.ts
 * Builds and configures the Fastify HTTP server for the pipeline server.
 *
 * Registers all API endpoint groups and trigger sources onto a single Fastify instance.
 * CORS is enabled for all origins (credentials: true) so the monitoring UI can connect
 * from any dev-server port. A bearer-token middleware guards all `/api/*` routes except
 * `/api/health` and `/api/trigger/*` (which perform their own auth).
 *
 * API groups:
 *   GET  /api/health                         — liveness + registry counts
 *   GET  /api/runs, GET /api/runs/:sessionId — run queries
 *   GET  /api/runs/:sessionId/logs           — trace log retrieval
 *   GET  /api/runs/:sessionId/stream         — SSE live event stream
 *   POST /api/runs/:sessionId/cancel         — cancel in-flight run
 *   DELETE /api/runs/:sessionId              — delete run state/logs/artifacts/workspace
 *   POST /api/runs/:sessionId/resume         — resume blocked run
 *   POST /api/runs/:sessionId/retry          — retry failed run from first failed step
 *   POST /api/human-loop/advance             — advance blocked run by (productId, ticketKey)
 *   GET  /api/runs/:sessionId/artifacts/:key — download artifact blob
 *   GET  /api/flows                          — list registered flows
 *   GET  /api/providers                      — list registered providers by category
 *
 * Trigger sources (e.g. ApiTrigger, GitHubWebhookTrigger) mount their own routes
 * via `ITriggerSource.mount()`.
 */

import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import type {
  IStateStore, ITraceLogger, IArtifactStore, IFlowConfigSource, IFlowResolver,
  ITriggerSource, PipelineTrigger, PipelineConfig, IProviderMeta,
} from "@journeyman/core";
import type { Pipeline } from "@journeyman/pipeline";
import { registerHealth, type HealthApiDeps } from "./api/health.ts";
import { registerRunsApi } from "./api/runs.ts";
import { registerLogsApi } from "./api/logs.ts";
import { registerStreamApi, type EventBusLike } from "./api/stream.ts";
import { registerCancelApi } from "./api/cancel.ts";
import { registerDeleteApi } from "./api/delete.ts";
import { registerResumeApi } from "./api/resume.ts";
import { registerRetryApi } from "./api/retry.ts";
import { registerHumanLoopApi } from "./api/human-loop.ts";
import { registerArtifactsApi } from "./api/artifacts.ts";
import { registerFlowsApi } from "./api/flows.ts";
import { registerProvidersApi } from "./api/providers.ts";
import { registerProductsApi } from "./api/products.ts";

export type ServerDeps = {
  config: PipelineConfig;
  bearerToken: string;
  phases: { list(): string[] };
  providers: { listByCategory(c: IProviderMeta["category"]): IProviderMeta[] };
  flows: IFlowConfigSource;
  resolver: IFlowResolver;
  pipeline: Pipeline;
  state: IStateStore;
  trace: ITraceLogger;
  artifactStore: IArtifactStore;
  bus: EventBusLike;
  triggers: ITriggerSource[];
  dispatch: (trigger: PipelineTrigger) => void;
};

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
  await app.register(sensible);
  await app.register(cors, { origin: true, credentials: true });

  app.addHook("onRequest", async (req, reply) => {
    const u = req.url;
    if (!u.startsWith("/api/")) return;
    if (u === "/api/health") return;
    if (u.startsWith("/api/trigger")) return;   // ApiTrigger checks bearer itself
    if (req.headers.authorization !== `Bearer ${deps.bearerToken}`) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  registerHealth(app, deps as HealthApiDeps);
  registerRunsApi(app, deps);
  registerLogsApi(app, deps);
  registerStreamApi(app, deps);
  registerCancelApi(app, { pipeline: deps.pipeline as any, state: deps.state });
  registerDeleteApi(app, {
    pipeline: deps.pipeline as any,
    state: deps.state,
    trace: deps.trace,
    artifactStore: deps.artifactStore,
    config: deps.config,
  });
  registerResumeApi(app, { pipeline: deps.pipeline as any });
  registerRetryApi(app, { pipeline: deps.pipeline as any });
  registerHumanLoopApi(app, { pipeline: deps.pipeline as any, state: deps.state });
  registerArtifactsApi(app, { state: deps.state, artifactStore: deps.artifactStore });
  registerFlowsApi(app, deps);
  registerProvidersApi(app, deps);
  registerProductsApi(app, deps);

  for (const t of deps.triggers) {
    t.mount(app, {
      products: deps.config.products,
      webhookConfig: deps.config.server.webhooks,
      onTrigger: deps.dispatch,
    });
  }

  return app;
}
