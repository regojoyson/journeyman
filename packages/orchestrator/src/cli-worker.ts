#!/usr/bin/env node
/**
 * Standalone worker process. Polls Conductor for tasks of the registered
 * phase types and dispatches them to handlers.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger } from "@journeyman/core";
import { ClaudeProvider } from "@journeyman/coding-cli";
import { GitHubProvider } from "@journeyman/git-provider";
import { JiraProvider, GitHubIssuesProvider, GitHubProjectsProvider } from "@journeyman/ticket-provider";
import type {
  ITicketProvider, ICodingCLI, IGitProvider, INotificationProvider,
  ProviderFactory, SecretBinding,
} from "@journeyman/core";
import { ConsoleProvider } from "@journeyman/notification-provider";
import { ConductorClient } from "./engines/conductor/conductor-client.ts";
import { InMemoryPhaseRegistry } from "./registry/in-memory-phase-registry.ts";
import { DirectoryWorkspaceProvider } from "./workspace/directory-workspace-provider.ts";
import { MemoryEventBus } from "./stores/memory/memory-event-bus.ts";
import { WorkerHarness } from "./workers/worker-harness.ts";
import { AnalyzeRepoPhaseHandler } from "./workers/phases/analyze-repo-phase-handler.ts";
import { PlanImplementationPhaseHandler } from "./workers/phases/plan-implementation-phase-handler.ts";
import { ImplementChangesPhaseHandler } from "./workers/phases/implement-changes-phase-handler.ts";
import { CreateWorkspacePhaseHandler } from "./workers/phases/create-workspace-phase-handler.ts";
import { StartFeatureBranchPhaseHandler } from "./workers/phases/start-feature-branch-phase-handler.ts";
import { CloneReposPhaseHandler } from "./workers/phases/clone-repos-phase-handler.ts";
import { GetTicketPhaseHandler } from "./workers/phases/get-ticket-phase-handler.ts";
import { TransitionTicketPhaseHandler } from "./workers/phases/transition-ticket-phase-handler.ts";
import { ListWorkspaceFilesPhaseHandler } from "./workers/phases/list-workspace-files-phase-handler.ts";
import { CommitAndPushPhaseHandler } from "./workers/phases/commit-and-push-phase-handler.ts";
import { CleanupWorkspacePhaseHandler } from "./workers/phases/cleanup-workspace-phase-handler.ts";
import { GetRepositoryPhaseHandler } from "./workers/phases/get-repository-phase-handler.ts";
import { OpenPullRequestPhaseHandler } from "./workers/phases/open-pull-request-phase-handler.ts";
import { ListPullRequestsPhaseHandler } from "./workers/phases/list-pull-requests-phase-handler.ts";
import { ListPullRequestCommentsPhaseHandler } from "./workers/phases/list-pull-request-comments-phase-handler.ts";
import { CreateTicketPhaseHandler } from "./workers/phases/create-ticket-phase-handler.ts";
import { UpdateTicketFieldsPhaseHandler } from "./workers/phases/update-ticket-fields-phase-handler.ts";
import { CommentOnTicketPhaseHandler } from "./workers/phases/comment-on-ticket-phase-handler.ts";
import { SendMessagePhaseHandler } from "./workers/phases/send-message-phase-handler.ts";

const log = createLogger("worker:cli");
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) loadDotenv({ path: envFile, override: false });

const baseUrl = process.env.CONDUCTOR_BASE_URL ?? "http://localhost:8080/api";
const client = new ConductorClient({ baseUrl });

const registry = new InMemoryPhaseRegistry();

const coding: ProviderFactory<ICodingCLI> = (key, env) => {
  switch (key ?? "claude") {
    case "claude":
      return new ClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY });
    default:
      throw new Error(`Unknown coding provider: ${key}`);
  }
};
registry.register(new AnalyzeRepoPhaseHandler({ coding }));
registry.register(new PlanImplementationPhaseHandler({ coding }));
registry.register(new ImplementChangesPhaseHandler({ coding }));
registry.register(new CreateWorkspacePhaseHandler({ coding }));
registry.register(new StartFeatureBranchPhaseHandler({ coding }));
registry.register(new ListWorkspaceFilesPhaseHandler({ coding }));
registry.register(new CommitAndPushPhaseHandler({ coding }));
registry.register(new CleanupWorkspacePhaseHandler({ coding }));

const git: ProviderFactory<IGitProvider> = (key, env) => {
  switch (key ?? "github") {
    case "github":
      return new GitHubProvider({ token: env.GITHUB_ACCESS_TOKEN });
    default:
      throw new Error(`Unknown git provider: ${key}`);
  }
};
registry.register(new CloneReposPhaseHandler({ git }));
registry.register(new GetRepositoryPhaseHandler({ git }));
registry.register(new OpenPullRequestPhaseHandler({ git }));
registry.register(new ListPullRequestsPhaseHandler({ git }));
registry.register(new ListPullRequestCommentsPhaseHandler({ git }));

const ticket: ProviderFactory<ITicketProvider> = (key, env) => {
  switch (key ?? "jira") {
    case "jira":
      return new JiraProvider({
        apiToken: env.JIRA_API_TOKEN,
        email: env.JIRA_EMAIL,
        host: env.JIRA_HOST,
      });
    case "github-issues":
      return new GitHubIssuesProvider({ token: env.GITHUB_ACCESS_TOKEN });
    case "github-projects":
      return new GitHubProjectsProvider({ token: env.GITHUB_ACCESS_TOKEN });
    default:
      throw new Error(`Unknown ticket provider: ${key}`);
  }
};
registry.register(new GetTicketPhaseHandler({ ticket }));
registry.register(new TransitionTicketPhaseHandler({ ticket }));
registry.register(new CreateTicketPhaseHandler({ ticket }));
registry.register(new UpdateTicketFieldsPhaseHandler({ ticket }));
registry.register(new CommentOnTicketPhaseHandler({ ticket }));

const notification: ProviderFactory<INotificationProvider> = (key, _env) => {
  switch (key ?? "console") {
    case "console":
      return new ConsoleProvider();
    default:
      throw new Error(`Unknown notification provider: ${key}`);
  }
};
registry.register(new SendMessagePhaseHandler({ notification }));

// Register matching task definitions (idempotent)
for (const handler of registry.list()) {
  await client.putTaskDef({
    name: handler.phaseType,
    retryCount: 0,
    timeoutSeconds: 600,
    timeoutPolicy: "TIME_OUT_WF",
    retryLogic: "FIXED",
    retryDelaySeconds: 0,
    responseTimeoutSeconds: 600,
    ownerEmail: "ops@journeyman.local",
  });
}

const cliBindingResolver = async (input: {
  ctx: { userId: string | null; flowId: string | null };
  slots: Array<{ name: string; optional?: boolean }>;
  bindings: Record<string, SecretBinding>;
}): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const slot of input.slots) {
    const b = input.bindings[slot.name] ?? { mode: "auto" as const };
    if (b.mode === "pinned") {
      throw new Error(
        `cli-worker cannot resolve pinned binding for slot "${slot.name}" — ` +
        `pinned scopes (user/org) require a database. Run via api-server.`,
      );
    }
    const v = process.env[`JM_GLOBAL_${slot.name}`] ?? process.env[slot.name];
    if (v != null) { out[slot.name] = v; continue; }
    if (!slot.optional) missing.push(slot.name);
  }
  if (missing.length > 0) {
    const err = new Error(`Missing required secrets: ${missing.join(", ")}`) as Error & { name: string; missing: string[] };
    err.name = "MissingSecretsError";
    err.missing = missing;
    throw err;
  }
  return out;
};

const harness = new WorkerHarness({
  client,
  registry,
  workspace: new DirectoryWorkspaceProvider(),
  events: new MemoryEventBus(),
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}`,
  pollIntervalMs: 500,
  bindingResolver: cliBindingResolver,
});

log.info({ phases: registry.list().map(h => h.phaseType) }, "worker starting");
await harness.start(registry.list().map(h => h.phaseType));
