import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
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
import { registerResumeApi } from "./api/resume.ts";
import { registerArtifactsApi } from "./api/artifacts.ts";
import { registerFlowsApi } from "./api/flows.ts";
import { registerProvidersApi } from "./api/providers.ts";

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
  registerResumeApi(app, { pipeline: deps.pipeline as any });
  registerArtifactsApi(app, { state: deps.state, artifactStore: deps.artifactStore });
  registerFlowsApi(app, deps);
  registerProvidersApi(app, deps);

  for (const t of deps.triggers) {
    t.mount(app, {
      products: deps.config.products,
      webhookConfig: deps.config.server.webhooks,
      onTrigger: deps.dispatch,
    });
  }

  return app;
}
