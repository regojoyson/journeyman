#!/usr/bin/env node
/**
 * Standalone worker process. Polls Conductor for tasks of the registered
 * step types and dispatches them to handlers.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLogger } from "@journeyman/core";
import { ClaudeProvider } from "@journeyman/coding-cli";
import { GitHubProvider } from "@journeyman/git-provider";
import { JiraProvider, GitHubIssuesProvider, GitHubProjectsProvider } from "@journeyman/ticket-provider";
import type {
  IIssueProvider, ICodingCLI, IGitProvider, INotificationProvider,
  ProviderFactory, SecretBinding,
  ExecOp, ExecResult, ProvisionedEnv,
} from "@journeyman/core";
import { DockerExecutionEnvironment, makeProcessCommandRunner, getSandbox } from "@journeyman/workers";
import { ConsoleProvider } from "@journeyman/notification-provider";
import { resolveBindings } from "@journeyman/secrets";
import { resolveMcpInstances } from "@journeyman/mcp";
import { resolveSkillPackagesByIds } from "@journeyman/skills";
import { findDefaultCodingModel } from "@journeyman/coding-models";
import { Pool } from "pg";
import { ConductorClient } from "./engines/conductor/conductor-client.ts";
import { InMemoryStepRegistry } from "./registry/in-memory-step-registry.ts";
import { DirectoryWorkspaceProvider } from "./workspace/directory-workspace-provider.ts";
import { MemoryEventBus } from "./stores/memory/memory-event-bus.ts";
import { PostgresEventBus } from "./stores/postgres/postgres-event-bus.ts";
import { WorkerHarness } from "./workers/worker-harness.ts";
import { CreateWorkspaceStepHandler } from "./workers/steps/create-workspace-step-handler.ts";
import { StartFeatureBranchStepHandler } from "./workers/steps/start-feature-branch-step-handler.ts";
import { CloneReposStepHandler } from "./workers/steps/clone-repos-step-handler.ts";
import { GetIssueStepHandler } from "./workers/steps/get-issue-step-handler.ts";
import { TransitionIssueStepHandler } from "./workers/steps/transition-issue-step-handler.ts";
import { ListWorkspaceFilesStepHandler } from "./workers/steps/list-workspace-files-step-handler.ts";
import { CleanupWorkspaceStepHandler } from "./workers/steps/cleanup-workspace-step-handler.ts";
import { GetRepositoryStepHandler } from "./workers/steps/get-repository-step-handler.ts";
import { OpenPullRequestStepHandler } from "./workers/steps/open-pull-request-step-handler.ts";
import { ListPullRequestsStepHandler } from "./workers/steps/list-pull-requests-step-handler.ts";
import { ListPullRequestCommentsStepHandler } from "./workers/steps/list-pull-request-comments-step-handler.ts";
import { CreateIssueStepHandler } from "./workers/steps/create-issue-step-handler.ts";
import { UpdateIssueFieldsStepHandler } from "./workers/steps/update-issue-fields-step-handler.ts";
import { CommentOnIssueStepHandler } from "./workers/steps/comment-on-issue-step-handler.ts";
import { SendMessageStepHandler } from "./workers/steps/send-message-step-handler.ts";
import { CustomAiStepHandler } from "./workers/steps/custom-ai-step-handler.ts";
import { JoinFinalizeStepHandler } from "./workers/steps/join-finalize-step-handler.ts";

const log = createLogger("worker:cli");
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) loadDotenv({ path: envFile, override: false });

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

if (pool) {
  await pool.query("SELECT 1");
  log.info("worker DB pool connected");
}

const baseUrl = process.env.CONDUCTOR_BASE_URL ?? "http://localhost:8080/api";
const client = new ConductorClient({ baseUrl });

const registry = new InMemoryStepRegistry();

const coding: ProviderFactory<ICodingCLI> = (key, env) => {
  switch (key ?? "claude") {
    case "claude":
      return new ClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY });
    default: {
      const err = new Error(`Unknown coding provider: ${key}`) as Error & { name: string };
      err.name = "ConfigurationError";
      throw err;
    }
  }
};
const workspaceBaseDir = process.env.JOURNEYMAN_BASE_DIR ?? join(tmpdir(), "journeyman-workspaces");

// Sandbox routing: for runs whose worker provisioned a (non-local) container,
// resolve an exec fn that docker-execs the run's runner. Returns null otherwise
// (→ handlers run in-process exactly as before).
const RUNNER_IMAGE = process.env.JOURNEYMAN_RUNNER_IMAGE ?? "journeyman/runner-base:dev";
const dockerCmd = makeProcessCommandRunner("docker");
const sandboxResolver = async (
  workflowInstanceId: string,
): Promise<((op: ExecOp) => Promise<ExecResult>) | null> => {
  if (!pool) return null;
  const sb = await getSandbox(pool, workflowInstanceId);
  if (!sb || sb.status !== "active" || sb.type !== "docker") return null;
  const env = new DockerExecutionEnvironment({ docker: dockerCmd, defaultImage: RUNNER_IMAGE });
  const provisioned: ProvisionedEnv = {
    runId: sb.runId, type: "docker", handle: sb.handle,
    volume: sb.volume ?? undefined, workspaceDir: "/workspace",
  };
  return (op: ExecOp) => env.exec(provisioned, op);
};

registry.register(new CreateWorkspaceStepHandler({ coding, baseDir: workspaceBaseDir }));
registry.register(new StartFeatureBranchStepHandler({ coding }));
registry.register(new ListWorkspaceFilesStepHandler({ coding }));
registry.register(new CleanupWorkspaceStepHandler({ coding }));
registry.register(new JoinFinalizeStepHandler());
if (pool) {
  // cliBindingResolver is declared later in this file; wrap in a thunk so the
  // reference is captured lazily and avoids the temporal dead zone.
  registry.register(new CustomAiStepHandler({
    coding,
    pool,
    bindingResolver: (input) => cliBindingResolver(input),
  }));
}

const git: ProviderFactory<IGitProvider> = (key, env) => {
  switch (key ?? "github") {
    case "github":
      return new GitHubProvider({ token: env.GITHUB_ACCESS_TOKEN });
    default: {
      const err = new Error(`Unknown git provider: ${key}`) as Error & { name: string };
      err.name = "ConfigurationError";
      throw err;
    }
  }
};
registry.register(new CloneReposStepHandler({ git }));
registry.register(new GetRepositoryStepHandler({ git }));
registry.register(new OpenPullRequestStepHandler({ git }));
registry.register(new ListPullRequestsStepHandler({ git }));
registry.register(new ListPullRequestCommentsStepHandler({ git }));

const issue: ProviderFactory<IIssueProvider> = (key, env) => {
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
    default: {
      const err = new Error(`Unknown issue provider: ${key}`) as Error & { name: string };
      err.name = "ConfigurationError";
      throw err;
    }
  }
};
registry.register(new GetIssueStepHandler({ issue }));
registry.register(new TransitionIssueStepHandler({ issue }));
registry.register(new CreateIssueStepHandler({ issue }));
registry.register(new UpdateIssueFieldsStepHandler({ issue }));
registry.register(new CommentOnIssueStepHandler({ issue }));

const notification: ProviderFactory<INotificationProvider> = (key, _env) => {
  switch (key ?? "console") {
    case "console":
      return new ConsoleProvider();
    default: {
      const err = new Error(`Unknown notification provider: ${key}`) as Error & { name: string };
      err.name = "ConfigurationError";
      throw err;
    }
  }
};
registry.register(new SendMessageStepHandler({ notification }));

// Register matching task definitions (idempotent).
// retryCount here is a catalog-level cap. Per-flow retry policy (defaults.retry)
// sets the actual count per workflow task — it cannot exceed this cap.
// Keeping it at 10 gives flows enough headroom while preventing runaway retries.
for (const handler of registry.list()) {
  await client.putTaskDef({
    name: handler.stepType,
    retryCount: 10,
    timeoutSeconds: 600,
    timeoutPolicy: "TIME_OUT_WF",
    retryLogic: "EXPONENTIAL_BACKOFF",
    retryDelaySeconds: 5,
    backoffScaleFactor: 2,
    responseTimeoutSeconds: 600,
    ownerEmail: "ops@journeyman.local",
  });
}

const cliBindingResolver = async (input: {
  ctx: { userId: string | null; orgId: string | null; workflowId: string | null };
  slots: Array<{ name: string; optional?: boolean }>;
  bindings: Record<string, SecretBinding>;
}): Promise<Record<string, string>> => {
  const { ctx, slots, bindings } = input;

  if (pool) {
    // DB-backed resolution: supports auto + pinned (user / org / global).
    if (!ctx.userId || !ctx.orgId) {
      const pinnedSlot = slots.find(s => (bindings[s.name] ?? { mode: "auto" }).mode === "pinned");
      if (pinnedSlot) {
        const err = new Error(
          `pinned binding for slot "${pinnedSlot.name}" requires userId/orgId context — ` +
          `was the workflow started via api-server?`,
        ) as Error & { name: string; missing: string[] };
        err.name = "MissingSecretsError";
        err.missing = [pinnedSlot.name];
        throw err;
      }
    }
    const runCtx = {
      user: { id: ctx.userId ?? "", username: "" },
      org: { id: ctx.orgId ?? "", slug: "" },
      membershipId: "",
      role: "member" as const,
      isPlatformAdmin: false,
      tokenKind: "access-jwt" as const,
    };
    const result = await resolveBindings({ pool, ctx: runCtx, bindings, slots });
    return result.values;
  }

  // Env-only path (no DATABASE_URL): auto bindings from process.env only.
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const slot of slots) {
    const b = bindings[slot.name] ?? { mode: "auto" as const };
    if (b.mode === "pinned") {
      const err = new Error(
        `cli-worker cannot resolve pinned binding for slot "${slot.name}" — ` +
        `set DATABASE_URL or run via api-server.`,
      ) as Error & { name: string; missing: string[] };
      err.name = "MissingSecretsError";
      err.missing = [slot.name];
      throw err;
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

// Use the same Postgres event bus as the api-server so step events are visible
// in the run viewer. Fall back to in-memory only when DATABASE_URL isn't set.
const events = pool ? new PostgresEventBus(pool) : new MemoryEventBus();
if (!pool) {
  log.warn("DATABASE_URL not set — step events will be in-memory only and invisible to the workflow instance viewer");
}

const harness = new WorkerHarness({
  client,
  registry,
  workspace: new DirectoryWorkspaceProvider(),
  events,
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}`,
  pollIntervalMs: 500,
  bindingResolver: cliBindingResolver,
  mcpResolver: ({ ctx, instanceIds }) => {
    if (!pool) return Promise.resolve([]);
    return resolveMcpInstances(pool, ctx, instanceIds);
  },
  skillsResolver: ({ ctx, packageIds }) => {
    if (!pool) return Promise.resolve([]);
    return resolveSkillPackagesByIds(pool, ctx, packageIds, "claude");
  },
  modelResolver: async ({ provider }) => {
    if (!pool) return undefined;
    const m = await findDefaultCodingModel(pool, provider);
    return m?.modelId;
  },
  sandboxResolver,
});

log.info({ steps: registry.list().map(h => h.stepType) }, "worker starting");
await harness.start(registry.list().map(h => h.stepType));
