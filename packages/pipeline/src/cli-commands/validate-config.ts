import { join } from "node:path";
import {
  loadPipelineConfig, YamlFlowConfigSource, FlowValidator,
  PhaseRegistry, ProviderRegistry,
  GetTicketPhase, CloneReposPhase, AnalyzePhase, PlanPhase, ImplementPhase,
  CommitPushPhase, CreatePRPhase, CleanupReposPhase, AddCommentPhase,
  UpdateStatusPhase, ReviewPhase, RequireFieldPhase,
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
