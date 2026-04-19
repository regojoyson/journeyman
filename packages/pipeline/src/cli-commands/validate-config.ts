import { join } from "node:path";
import {
  loadPipelineConfig, YamlFlowConfigSource, FlowValidator,
  PhaseRegistry, ProviderRegistry,
  GetTicketPhase, CloneReposPhase, AnalyzePhase, PlanPhase, ImplementPhase,
  CommitPushPhase, CreatePRPhase, CleanupReposPhase, AddCommentPhase,
  UpdateStatusPhase, ReviewPhase, RequireFieldPhase, NotifyPhase,
  ScanReposPhase, ResetReposPhase, CreateWorkspacePhase,
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

export async function validateConfig(configPath: string): Promise<number> {
  try {
    const config = loadPipelineConfig(configPath);
    const flows = await YamlFlowConfigSource.fromDir(join(configPath, "..", "flows"));
    const flowList = await Promise.all((await flows.listFlows()).map(n => flows.getFlow(n)));

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
    phases.register("resetRepos",      () => new ResetReposPhase());
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

    FlowValidator.validate({ phases, providers, flows: flowList, products: config.products, defaultFlow: config.defaultFlow });
    console.log("✓ config valid");
    return 0;
  } catch (err: any) {
    console.error(`✗ ${err.message}`);
    return 1;
  }
}
