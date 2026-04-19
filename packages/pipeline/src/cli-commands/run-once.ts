import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  loadPipelineConfig, YamlFlowConfigSource, FlowValidator,
  PhaseRegistry, ProviderRegistry, FileStateStore, FileTraceLogger, FileArtifactStore,
  EventBus, Pipeline,
  GetTicketPhase, CloneReposPhase, AnalyzePhase, PlanPhase, ImplementPhase,
  CommitPushPhase, CreatePRPhase, CleanupReposPhase, AddCommentPhase,
  UpdateStatusPhase, ReviewPhase, RequireFieldPhase, NotifyPhase,
  ScanReposPhase, CheckoutRepoPhase, CreateWorkspacePhase,
  GetRepoPhase, ListPRsPhase,
  CreateTicketPhase, UpdateTicketPhase, ListTicketsPhase, GetTicketSchemaPhase,
} from "../index.ts";
import { ClaudeProvider, GeminiProvider, CodexProvider } from "@journeyman/coding-cli";
import { GitHubProvider, GitLabProvider } from "@journeyman/git-provider";
import {
  JiraProvider, LinearProvider, MondayProvider,
  GitHubIssuesProvider, GitHubProjectsProvider,
} from "@journeyman/ticket-provider";
import { SlackProvider } from "@journeyman/notification-provider";
import { createLogger } from "@journeyman/core";

const log = createLogger("pipeline:run-once");

function findProductIdSync(root: string, sessionId: string): string | null {
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    if (existsSync(join(root, d.name, "state", `${sessionId}.json`))) return d.name;
  }
  return null;
}

function deriveShortKey(key: string): string {
  const m = key.match(/#(\d+)$/);
  return m ? m[1]! : key;
}

export async function runOnce(
  configPath: string,
  productId: string,
  ticketKey: string,
  flowName?: string,
): Promise<number> {
  const config = loadPipelineConfig(configPath);
  const product = config.products[productId];
  if (!product) {
    log.error({ productId }, "Unknown product");
    return 1;
  }

  const phases = new PhaseRegistry();
  phases.register("getTicket",       () => new GetTicketPhase());
  phases.register("cloneRepos",      () => new CloneReposPhase());
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
  phases.register("notify",          () => new NotifyPhase());
  phases.register("scanRepos",       () => new ScanReposPhase());
  phases.register("checkoutRepo",    () => new CheckoutRepoPhase());
  phases.register("createWorkspace", () => new CreateWorkspacePhase());
  phases.register("getRepo",         () => new GetRepoPhase());
  phases.register("listPRs",         () => new ListPRsPhase());
  phases.register("createTicket",    () => new CreateTicketPhase());
  phases.register("updateTicket",    () => new UpdateTicketPhase());
  phases.register("listTickets",     () => new ListTicketsPhase());
  phases.register("getTicketSchema", () => new GetTicketSchemaPhase());

  const providers = new ProviderRegistry();
  for (const c of [
    ClaudeProvider, GeminiProvider, CodexProvider,
    GitHubProvider, GitLabProvider,
    JiraProvider, LinearProvider, MondayProvider,
    GitHubIssuesProvider, GitHubProjectsProvider,
    SlackProvider,
  ]) providers.register(c as any);

  const workspacesRoot = "./workspaces";
  const state = new FileStateStore(workspacesRoot);
  const resolveProduct = (sid: string) => findProductIdSync(workspacesRoot, sid);
  const trace = new FileTraceLogger(workspacesRoot, resolveProduct);
  const artifactStore = new FileArtifactStore(workspacesRoot, resolveProduct);
  const bus = new EventBus();

  const flows = await YamlFlowConfigSource.fromDir(join(configPath, "..", "flows"));
  const flowList = await Promise.all((await flows.listFlows()).map(n => flows.getFlow(n)));
  FlowValidator.validate({ phases, providers, flows: flowList, products: config.products, defaultFlow: config.defaultFlow });

  const resolvedFlowName = flowName ?? product.flow;
  const flow = await flows.getFlow(resolvedFlowName);

  const pipeline = new Pipeline({
    phases, state, trace, artifactStore, bus,
    resolveProviders: (f, pc) => providers.resolveForProduct(f, pc),
    getProductConfig: (pid) => config.products[pid],
    cleanupOn: config.workspaces?.cleanupOn,
  });

  const run = await pipeline.run({
    trigger: {
      sourceId: "cli",
      productId,
      ticketKey,
      ticketShortKey: deriveShortKey(ticketKey),
      rawPayload: {},
      receivedAt: new Date().toISOString(),
    },
    flow,
  });

  log.info({ sessionId: run.sessionId, status: run.status }, "run complete");
  if (run.status === "completed") return 0;
  if (run.status === "blocked")   return 2;
  return 1;
}
