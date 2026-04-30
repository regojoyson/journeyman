#!/usr/bin/env node
/**
 * Standalone worker process. Polls Conductor for tasks of the registered
 * phase types and dispatches them to handlers.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger, PROVIDER_CATALOG } from "@journeyman/core";
import { ClaudeProvider } from "@journeyman/coding-cli";
import { GitHubProvider } from "@journeyman/git-provider";
import { JiraProvider, GitHubIssuesProvider, GitHubProjectsProvider } from "@journeyman/ticket-provider";
import type { ITicketProvider, ICodingCLI, IGitProvider, INotificationProvider, CoreExecutorKind, ProviderResolver } from "@journeyman/core";
import { MapProviderResolver } from "./registry/map-provider-resolver.ts";
import { ConsoleProvider } from "@journeyman/notification-provider";
import { ConductorClient } from "./engines/conductor/conductor-client.ts";
import { InMemoryPhaseRegistry } from "./registry/in-memory-phase-registry.ts";
import { DirectoryWorkspaceProvider } from "./workspace/directory-workspace-provider.ts";
import { EnvCredentialStore } from "./credentials/env-credential-store.ts";
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

function assertResolverMatchesCatalog(kind: CoreExecutorKind, resolver: ProviderResolver<unknown>): void {
  const expected = PROVIDER_CATALOG
    .filter(p => p.kind === kind && p.implemented)
    .map(p => p.value)
    .sort();
  const actual = [...resolver.keys()].sort();
  const missing = expected.filter(k => !actual.includes(k));
  const extra   = actual.filter(k => !expected.includes(k));
  if (missing.length || extra.length) {
    throw new Error(
      `Provider catalog mismatch for "${kind}". ` +
      `Catalog says implemented=[${expected.join(", ")}], ` +
      `worker registered=[${actual.join(", ")}]. ` +
      `Missing in worker: [${missing.join(", ")}]. Extra in worker: [${extra.join(", ")}]. ` +
      `Update PROVIDER_CATALOG or the resolver registration.`,
    );
  }
}

const baseUrl = process.env.CONDUCTOR_BASE_URL ?? "http://localhost:8080/api";
const client = new ConductorClient({ baseUrl });

const registry = new InMemoryPhaseRegistry();
const coding = new MapProviderResolver<ICodingCLI>({
  kind: "coding-cli",
  defaultKey: "claude",
  providers: { "claude": new ClaudeProvider() },
});
registry.register(new AnalyzeRepoPhaseHandler({ coding }));
registry.register(new PlanImplementationPhaseHandler({ coding }));
registry.register(new ImplementChangesPhaseHandler({ coding }));
registry.register(new CreateWorkspacePhaseHandler({ coding }));
registry.register(new StartFeatureBranchPhaseHandler({ coding }));
registry.register(new ListWorkspaceFilesPhaseHandler({ coding }));
registry.register(new CommitAndPushPhaseHandler({ coding }));
registry.register(new CleanupWorkspacePhaseHandler({ coding }));

// Git provider (clone/get/PR/list/comments). Skipped if GITHUB_ACCESS_TOKEN not set.
try {
  const git = new MapProviderResolver<IGitProvider>({
    kind: "git-provider",
    defaultKey: "github",
    providers: { "github": new GitHubProvider() },
  });
  registry.register(new CloneReposPhaseHandler({ git }));
  registry.register(new GetRepositoryPhaseHandler({ git }));
  registry.register(new OpenPullRequestPhaseHandler({ git }));
  registry.register(new ListPullRequestsPhaseHandler({ git }));
  registry.register(new ListPullRequestCommentsPhaseHandler({ git }));
  assertResolverMatchesCatalog("git-provider", git);
} catch (err) {
  log.warn({ err: (err as Error).message }, "skipping git-provider handlers — provider unavailable");
}

// Ticket providers — selected per-node via PhaseInput.provider, default "jira".
const ticket = new MapProviderResolver<ITicketProvider>({
  kind: "ticket-provider",
  defaultKey: "jira",
  providers: {
    "jira":            new JiraProvider(),
    "github-issues":   new GitHubIssuesProvider(),
    "github-projects": new GitHubProjectsProvider(),
  },
});
registry.register(new GetTicketPhaseHandler({ ticket }));
registry.register(new TransitionTicketPhaseHandler({ ticket }));
registry.register(new CreateTicketPhaseHandler({ ticket }));
registry.register(new UpdateTicketFieldsPhaseHandler({ ticket }));
registry.register(new CommentOnTicketPhaseHandler({ ticket }));

// Notification provider (Console — always available; logs to stdout).
const notification = new MapProviderResolver<INotificationProvider>({
  kind: "notification",
  defaultKey: "console",
  providers: { "console": new ConsoleProvider() },
});
registry.register(new SendMessagePhaseHandler({ notification }));

assertResolverMatchesCatalog("coding-cli",      coding);
assertResolverMatchesCatalog("ticket-provider", ticket);
assertResolverMatchesCatalog("notification",    notification);

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

const harness = new WorkerHarness({
  client,
  registry,
  workspace: new DirectoryWorkspaceProvider(),
  credentials: new EnvCredentialStore(),
  events: new MemoryEventBus(),
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}`,
  pollIntervalMs: 500,
});

log.info({ phases: registry.list().map(h => h.phaseType) }, "worker starting");
await harness.start(registry.list().map(h => h.phaseType));
