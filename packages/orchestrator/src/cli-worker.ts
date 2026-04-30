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
import { AnalyzePhaseHandler } from "./workers/phases/analyze-phase-handler.ts";
import { PlanPhaseHandler } from "./workers/phases/plan-phase-handler.ts";
import { ImplementPhaseHandler } from "./workers/phases/implement-phase-handler.ts";
import { CreateWorkspacePhaseHandler } from "./workers/phases/create-workspace-phase-handler.ts";
import { CheckoutRepoPhaseHandler } from "./workers/phases/checkout-repo-phase-handler.ts";
import { CloneReposPhaseHandler } from "./workers/phases/clone-repos-phase-handler.ts";
import { GetTicketPhaseHandler } from "./workers/phases/get-ticket-phase-handler.ts";
import { UpdateStatusPhaseHandler } from "./workers/phases/update-status-phase-handler.ts";
import { ScanReposPhaseHandler } from "./workers/phases/scan-repos-phase-handler.ts";
import { CommitPushPhaseHandler } from "./workers/phases/commit-push-phase-handler.ts";
import { CleanupReposPhaseHandler } from "./workers/phases/cleanup-repos-phase-handler.ts";
import { GetRepoPhaseHandler } from "./workers/phases/get-repo-phase-handler.ts";
import { CreatePrPhaseHandler } from "./workers/phases/create-pr-phase-handler.ts";
import { ListPrsPhaseHandler } from "./workers/phases/list-prs-phase-handler.ts";
import { FetchPrCommentsPhaseHandler } from "./workers/phases/fetch-pr-comments-phase-handler.ts";
import { CreateTicketPhaseHandler } from "./workers/phases/create-ticket-phase-handler.ts";
import { UpdateTicketPhaseHandler } from "./workers/phases/update-ticket-phase-handler.ts";
import { AddTicketCommentPhaseHandler } from "./workers/phases/add-ticket-comment-phase-handler.ts";
import { NotifyPhaseHandler } from "./workers/phases/notify-phase-handler.ts";

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
registry.register(new AnalyzePhaseHandler({ coding }));
registry.register(new PlanPhaseHandler({ coding }));
registry.register(new ImplementPhaseHandler({ coding }));
registry.register(new CreateWorkspacePhaseHandler({ coding }));
registry.register(new CheckoutRepoPhaseHandler({ coding }));
registry.register(new ScanReposPhaseHandler({ coding }));
registry.register(new CommitPushPhaseHandler({ coding }));
registry.register(new CleanupReposPhaseHandler({ coding }));

// Git provider (clone/get/PR/list/comments). Skipped if GITHUB_ACCESS_TOKEN not set.
try {
  const git = new MapProviderResolver<IGitProvider>({
    kind: "git-provider",
    defaultKey: "github",
    providers: { "github": new GitHubProvider() },
  });
  registry.register(new CloneReposPhaseHandler({ git }));
  registry.register(new GetRepoPhaseHandler({ git }));
  registry.register(new CreatePrPhaseHandler({ git }));
  registry.register(new ListPrsPhaseHandler({ git }));
  registry.register(new FetchPrCommentsPhaseHandler({ git }));
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
registry.register(new UpdateStatusPhaseHandler({ ticket }));
registry.register(new CreateTicketPhaseHandler({ ticket }));
registry.register(new UpdateTicketPhaseHandler({ ticket }));
registry.register(new AddTicketCommentPhaseHandler({ ticket }));

// Notification provider (Console — always available; logs to stdout).
const notification = new MapProviderResolver<INotificationProvider>({
  kind: "notification",
  defaultKey: "console",
  providers: { "console": new ConsoleProvider() },
});
registry.register(new NotifyPhaseHandler({ notification }));

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
