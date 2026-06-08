#!/usr/bin/env node
/**
 * Standalone worker process. Polls Conductor for tasks of the registered
 * step types and dispatches them to handlers.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { createLogger } from "@journeyman/core";
import { createCodingProvider } from "@journeyman/agent-runtime";
import { GitHubProvider } from "@journeyman/git-provider";
import { JiraProvider, GitHubIssuesProvider, GitHubProjectsProvider } from "@journeyman/ticket-provider";
import type {
  IIssueProvider, ICodingCLI, IGitProvider, INotificationProvider,
  ProviderFactory, SecretBinding, ProvisionedEnv,
} from "@journeyman/core";
import {
  DockerExecutionEnvironment, LocalExecutionEnvironment,
  makeDockerClient, getSandboxInstance, claimSandboxInstance, markSandboxInstanceActive, resolveSandbox,
  markImagePending, startBuildLoop, ensureKitImage,
} from "@journeyman/sandbox";
import { createCodingOperationRunner } from "@journeyman/agent-runtime";
import { ensureWorkspace } from "./sandbox/ensure-workspace.ts";
import { ConsoleProvider } from "@journeyman/notification-provider";
import { resolveBindings } from "@journeyman/secrets";
import { resolveMcpInstances } from "@journeyman/mcp";
import { resolveSkillPackagesByIds } from "@journeyman/skills";
import { findDefaultCodingModel } from "@journeyman/coding-models";
import { Pool } from "pg";
import { ConductorClient } from "./engines/conductor/conductor-client.ts";
import { InMemoryStepRegistry } from "./registry/in-memory-step-registry.ts";
import { MemoryEventBus } from "./stores/memory/memory-event-bus.ts";
import { PostgresEventBus } from "./stores/postgres/postgres-event-bus.ts";
import { WorkerHarness } from "./workers/worker-harness.ts";
import { resolvePollIntervalMs } from "./workers/poll-interval.ts";
import { StartFeatureBranchStepHandler } from "./workers/steps/start-feature-branch-step-handler.ts";
import { CloneReposStepHandler } from "./workers/steps/clone-repos-step-handler.ts";
import { GetIssueStepHandler } from "./workers/steps/get-issue-step-handler.ts";
import { TransitionIssueStepHandler } from "./workers/steps/transition-issue-step-handler.ts";
import { ListWorkspaceFilesStepHandler } from "./workers/steps/list-workspace-files-step-handler.ts";
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

const coding: ProviderFactory<ICodingCLI> = (key, env) => createCodingProvider(key, { env });

// Single data root: JOURNEYMAN_BASE_DIR/{workspaces,skills,kit}. (Spec 2026-06-07)
const JOURNEYMAN_BASE_DIR = process.env.JOURNEYMAN_BASE_DIR ?? join(homedir(), ".journeyman");
const workspaceBaseDir = join(JOURNEYMAN_BASE_DIR, "workspaces");
const kitDir = join(JOURNEYMAN_BASE_DIR, "kit");
log.info(
  { baseDir: JOURNEYMAN_BASE_DIR, workspaces: workspaceBaseDir, kit: kitDir },
  "data directories resolved",
);

const RUNNER_IMAGE = process.env.JOURNEYMAN_RUNNER_IMAGE ?? "journeyman/runner-base:dev";
const RUNNER_BUNDLE = process.env.JOURNEYMAN_RUNNER_BUNDLE ?? "journeyman/runner-bundle:dev";
const RUNNER_BUNDLE_TAR = join(kitDir, "runner-bundle.tar");
const RUNNER_BASE_TAR = join(kitDir, "runner-base.tar");

/**
 * Poll until the sandbox row for `runId` becomes active, or timeout.
 * Used by ensureWorkspace when another worker raced us to provisioning.
 */
async function waitActive(
  db: NonNullable<typeof pool>,
  runId: string,
  timeoutMs: number,
): Promise<{ handle: string; volume?: string | null; connection?: unknown }> {
  const start = Date.now();
  for (;;) {
    const sb = await getSandboxInstance(db, runId);
    if (sb?.status === "active") {
      return { handle: sb.handle, volume: sb.volume, connection: sb.connection };
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`workspace provisioning timed out for run ${runId}`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/**
 * Demand-driven workspace provisioner — provision-if-missing, status-gated,
 * local + docker. Passed as the `ensureWorkspace` dep to WorkerHarness.
 */
const ensureWs = (a: {
  runId: string;
  sandboxId: string | undefined;
  userId: string | null;
  orgId: string | null;
  log?: (line: string) => void;
  verbose?: boolean;
}) =>
  ensureWorkspace(
    {
      getSandboxInstance: (id) => (pool ? getSandboxInstance(pool, id) : Promise.resolve(null)),
      claim: (row) => (pool ? claimSandboxInstance(pool, row) : Promise.resolve(true)),
      markActive: (id, patch) => (pool ? markSandboxInstanceActive(pool, id, patch) : Promise.resolve()),
      waitActive: (id, ms) =>
        pool ? waitActive(pool, id, ms) : Promise.reject(new Error("no pool")),
      resolveSandbox: async (sandboxId, ctx) => {
        if (pool) {
          const w = await resolveSandbox(pool, ctx, sandboxId);
          return {
            type: w.type,
            config: (w.config ?? {}) as Record<string, unknown>,
            imageState: w.imageState,
            imageRef: w.imageRef,
            imageError: w.imageError,
          };
        }
        return { type: "local" as const, config: {} };
      },
      onImagePending: async (id) => { if (pool) await markImagePending(pool, id); },
      provisionLocal: async (runId) => {
        const env = new LocalExecutionEnvironment({
          runOperation: createCodingOperationRunner({
            makeProvider: (envVars) => createCodingProvider(undefined, { env: envVars }),
          }),
          baseDir: workspaceBaseDir,
        });
        const provisioned = await env.provision(runId, {});
        return { env, provisioned };
      },
      provisionDocker: async (runId, worker) => {
        const connection = (worker.config as Record<string, unknown>)["connection"] ?? { kind: "local" };
        const dockerClient = makeDockerClient(connection as Parameters<typeof makeDockerClient>[0]);
        const env = new DockerExecutionEnvironment({ client: dockerClient, defaultImage: RUNNER_IMAGE });
        // If we are reconnecting to an existing container (connect() path), skip provisioning.
        const existingHandle = (worker.config as Record<string, unknown>)["__existingHandle"];
        if (existingHandle) {
          const provisioned: ProvisionedEnv = {
            runId,
            type: "docker",
            handle: String(existingHandle),
            volume: (worker.config as Record<string, unknown>)["__existingVolume"] as string | undefined,
            workspaceDir: "/workspace",
          };
          return { env, provisioned, connection };
        }
        // Spec B: never build inside the run. ensure-workspace's run-gating has
        // already confirmed the image is ready and stamped __imageRef (or left it
        // unset → use the default runner box).
        const cfg = worker.config as Record<string, unknown>;
        const preBuilt = cfg["__imageRef"] as string | undefined;
        const imageRef = preBuilt ?? RUNNER_IMAGE;
        // Empty-image targets run the default box directly (no build loop), so the
        // kit base must be present on this daemon — load it from the tar if missing.
        if (!preBuilt) await ensureKitImage(dockerClient, RUNNER_IMAGE, RUNNER_BASE_TAR);
        const spec = {
          imageRef,
          network: cfg["network"] === "none" ? ("none" as const) : ("full" as const),
          ...(cfg["resources"] ? { resources: cfg["resources"] as never } : {}),
          ...(cfg["env"] ? { env: cfg["env"] as Record<string, string> } : {}),
        };
        const provisioned = await env.provision(runId, spec);
        return { env, provisioned, imageRef: spec.imageRef, connection };
      },
    },
    a,
  );

registry.register(new StartFeatureBranchStepHandler({ coding }));
registry.register(new ListWorkspaceFilesStepHandler({ coding }));
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
async function registerTaskDefs(): Promise<void> {
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
}

// Conductor is a heavy JVM service that may not accept connections yet when the
// worker boots (depends_on only waits for the container to start). Retry the
// idempotent registration with exponential backoff instead of crashing on a
// transient ECONNREFUSED. Tune the ceiling with CONDUCTOR_STARTUP_TIMEOUT_MS.
{
  const startedAt = Date.now();
  const maxWaitMs = Number(process.env.CONDUCTOR_STARTUP_TIMEOUT_MS ?? 180_000);
  let delayMs = 1_000;
  for (;;) {
    try {
      await registerTaskDefs();
      log.info("task definitions registered with Conductor");
      break;
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      if (Date.now() - startedAt > maxWaitMs) {
        log.error({ err: message, maxWaitMs }, "Conductor unreachable; giving up task-def registration");
        throw err;
      }
      log.info({ delayMs, err: message }, "Conductor not ready yet — retrying task-def registration");
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, 10_000);
    }
  }
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
  events,
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}`,
  pollIntervalMs: resolvePollIntervalMs(),
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
  ensureWorkspace: ensureWs,
});

// Spec B: build managed sandbox images ahead of time (this process holds
// the Docker connection). Claims pending targets, builds, marks ready/failed.
const stopBuildLoop = pool
  ? startBuildLoop({
      db: pool,
      bundleRef: RUNNER_BUNDLE,
      bundleTarPath: RUNNER_BUNDLE_TAR,
      leaseMs: 120_000,
      intervalMs: 3000,
      log: (line) => log.info({ line }, "build-loop"),
    })
  : () => {};
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { stopBuildLoop(); });
}

log.info({ steps: registry.list().map(h => h.stepType) }, "worker starting");
await harness.start(registry.list().map(h => h.stepType));
