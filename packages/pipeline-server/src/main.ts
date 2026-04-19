import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  loadPipelineConfig, YamlFlowConfigSource, ConfigFlowResolver, FlowValidator,
  PhaseRegistry, ProviderRegistry, FileStateStore, FileTraceLogger, FileArtifactStore,
  EventBus, Pipeline, SemaphorePool, installShutdownHandler,
  GetTicketPhase, CloneReposPhase, AnalyzePhase, PlanPhase, ImplementPhase,
  CommitPushPhase, CreatePRPhase, CleanupReposPhase, AddCommentPhase,
  UpdateStatusPhase, ReviewPhase, RequireFieldPhase, CheckoutRepoPhase,
} from "@journeyman/pipeline";
import { ClaudeProvider, GeminiProvider, CodexProvider } from "@journeyman/coding-cli";
import { GitHubProvider, GitLabProvider } from "@journeyman/git-provider";
import {
  JiraProvider, LinearProvider, MondayProvider,
  GitHubIssuesProvider, GitHubProjectsProvider,
} from "@journeyman/ticket-provider";
import { SlackProvider } from "@journeyman/notification-provider";
import { createLogger } from "@journeyman/core";

const log = createLogger("server:main");
import { buildServer } from "./http-server.ts";
import { buildDispatcher } from "./dispatch.ts";
import { TicketMutex } from "./dedup.ts";
import { ApiTrigger } from "./triggers/api-trigger.ts";
import { GitHubWebhookTrigger } from "./triggers/github-webhook-trigger.ts";
import { GitLabWebhookTrigger } from "./triggers/gitlab-webhook-trigger.ts";
import { JiraWebhookTrigger } from "./triggers/jira-webhook-trigger.ts";

function findProductIdSync(root: string, sessionId: string): string | null {
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = join(root, d.name, "state", `${sessionId}.json`);
    if (existsSync(p)) return d.name;
  }
  return null;
}

export async function startServer(configPath: string): Promise<void> {
  const config = loadPipelineConfig(configPath);
  const bearerToken = process.env[config.server.bearerTokenEnv];
  if (!bearerToken) throw new Error(`${config.server.bearerTokenEnv} not set`);

  // ----- registries -----
  const phases = new PhaseRegistry();
  phases.register("getTicket",       () => new GetTicketPhase());
  phases.register("cloneRepos",      () => new CloneReposPhase());
  phases.register("checkoutRepo",    () => new CheckoutRepoPhase());
  phases.register("analyze",         () => new AnalyzePhase());
  phases.register("plan",            () => new PlanPhase());
  phases.register("implement",       () => new ImplementPhase());
  phases.register("commitPushRepos", () => new CommitPushPhase());
  phases.register("createPR",        () => new CreatePRPhase());
  phases.register("cleanupRepos",    () => new CleanupReposPhase());
  phases.register("addComment",      () => new AddCommentPhase());
  phases.register("updateStatus",    () => new UpdateStatusPhase());
  phases.register("review",          () => new ReviewPhase());
  phases.register("requireField",    () => new RequireFieldPhase());

  const providers = new ProviderRegistry();
  for (const c of [
    ClaudeProvider, GeminiProvider, CodexProvider,
    GitHubProvider, GitLabProvider,
    JiraProvider, LinearProvider, MondayProvider,
    GitHubIssuesProvider, GitHubProjectsProvider,
    SlackProvider,
  ]) {
    providers.register(c as any);
  }

  // ----- stores -----
  const workspacesRoot = "./workspaces";
  const state = new FileStateStore(workspacesRoot);
  const productIdResolver = (sid: string) => findProductIdSync(workspacesRoot, sid);
  const trace = new FileTraceLogger(workspacesRoot, productIdResolver);
  const artifactStore = new FileArtifactStore(workspacesRoot, productIdResolver);
  const bus = new EventBus();

  // ----- flows -----
  const flows = await YamlFlowConfigSource.fromDir(join(configPath, "..", "flows"));
  const flowList = await Promise.all((await flows.listFlows()).map(n => flows.getFlow(n)));
  FlowValidator.validate({
    phases, providers,
    flows: flowList,
    products: config.products,
    defaultFlow: config.defaultFlow,
  });

  // ----- pipeline + concurrency -----
  const semaphores = new SemaphorePool(
    Object.fromEntries(Object.entries(config.products).map(([k, v]) => [k, v.concurrency ?? Infinity])),
    Infinity,
  );

  const pipeline = new Pipeline({
    phases, state, trace, artifactStore, bus,
    resolveProviders: (flow, pc) => providers.resolveForProduct(flow, pc),
    getProductConfig: (pid) => config.products[pid],
    cleanupOn: config.workspaces?.cleanupOn,
  });

  await Pipeline.recover(state);

  // ----- dispatch -----
  const resolver = new ConfigFlowResolver(config);
  const mutex = new TicketMutex();
  const dispatch = buildDispatcher({ flows, resolver, pipeline, state, mutex, semaphores });

  // ----- triggers -----
  const triggers: any[] = [new ApiTrigger({ bearerToken })];
  if (config.server.webhooks.github) {
    triggers.push(new GitHubWebhookTrigger({
      defaultSecretEnv: config.server.webhooks.github.secretEnv,
    }));
  }
  if (config.server.webhooks.gitlab) {
    triggers.push(new GitLabWebhookTrigger({
      defaultSecretEnv: config.server.webhooks.gitlab.secretEnv,
      ticketKeyRegex: /([A-Z]+-\d+)/,
    }));
  }
  if (config.server.webhooks.jira) {
    triggers.push(new JiraWebhookTrigger({
      defaultSecretEnv: config.server.webhooks.jira.secretEnv,
    }));
  }

  // ----- server -----
  const app = await buildServer({
    config, bearerToken, phases, providers, flows, resolver,
    pipeline, state, trace, artifactStore, bus, triggers,
    dispatch: (trigger) => { void dispatch(trigger); },
  });

  installShutdownHandler(pipeline, async () => { await app.close(); });

  await app.listen({ port: config.server.port, host: "0.0.0.0" });
  log.info({ port: config.server.port }, "journeyman pipeline-server listening");
}
