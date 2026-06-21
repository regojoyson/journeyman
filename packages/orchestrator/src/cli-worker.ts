#!/usr/bin/env node
/**
 * Standalone worker process. Polls Conductor for tasks of the registered
 * step types and dispatches them to handlers.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { createLogger, codingModelKeySlot } from "@journeyman/core";
import { createCodingProvider } from "@journeyman/agent-runtime";
import { GitHubProvider, GitLabProvider } from "@journeyman/git-provider";
import { JiraProvider, GitHubIssuesProvider, GitHubProjectsProvider, LinearProvider, MondayProvider } from "@journeyman/ticket-provider";
import { getConnection, getConnectionSealed } from "@journeyman/connections";
import { open } from "@journeyman/secrets";
import type { ResolvedConnection } from "@journeyman/core";
import type {
  IIssueProvider, ICodingCLI, IGitProvider, INotificationProvider,
  ProviderFactory, SecretBinding, IEventBus,
} from "@journeyman/core";
import {
  createDefaultRegistry, makeWindowsAgentClient,
  makeDockerClient, getSandboxInstance, claimSandboxInstance, markSandboxInstanceActive, resolveSandbox,
  markImagePendingIfBuildable, startBuildLoop, ensureKitImage, resolveBuildInputs, pruneBuiltImages,
  listReadyImageRefs, listDockerSandboxConnections, resolveKitRefs, registryAuthFromEnv,
} from "@journeyman/sandbox";
import { createCodingOperationRunner } from "@journeyman/agent-runtime";
import { ensureWorkspace } from "./sandbox/ensure-workspace.ts";
import { buildNotificationProvider } from "@journeyman/notification-provider";
import { resolveBindings, fetchSecretById } from "@journeyman/secrets";
import { resolveMcpInstances } from "@journeyman/mcp";
import { resolveSkillPackagesByIds } from "@journeyman/skills";
import { findDefaultCodingModel, findCodingModel } from "@journeyman/coding-models";
import { Pool } from "pg";
import { ConductorClient } from "./engines/conductor/conductor-client.ts";
import { InMemoryStepRegistry } from "./registry/in-memory-step-registry.ts";
import { PostgresEventBus } from "./stores/postgres/postgres-event-bus.ts";
import { WorkerHarness } from "./workers/worker-harness.ts";
import { resolvePollIntervalMs } from "./workers/poll-interval.ts";
import { resolveConductorTaskTimeoutSeconds } from "./workers/step-timeouts.ts";
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
import { AgentRunStepHandler } from "./workers/steps/agent-run-step-handler.ts";
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
const REGISTRY_AUTH = registryAuthFromEnv(process.env);

/** Resolve the current kit refs (DB-first, env defaults as fallback). */
async function kitRefs(): Promise<{ base: string; bundle: string }> {
  if (!pool) return { base: RUNNER_IMAGE, bundle: RUNNER_BUNDLE };
  return resolveKitRefs(pool, { base: RUNNER_IMAGE, bundle: RUNNER_BUNDLE });
}

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
// Per-process backend registry. Docker deps carry a per-connection client
// factory + the kit/image callbacks (relocated from the old provision closures).
const workerRegistry = createDefaultRegistry({
  runOperation: createCodingOperationRunner({
    makeProvider: (envVars) => createCodingProvider(undefined, { env: envVars }),
  }),
  defaultBaseDir: workspaceBaseDir,
  docker: {
    makeClient: (connection) => makeDockerClient(connection as Parameters<typeof makeDockerClient>[0]),
    defaultImage: RUNNER_IMAGE,
    resolveImageRef: async (config, client) => {
      // Spec B: never build inside the run. checkRunnable has already confirmed
      // readiness and stamped __imageRef (or left it unset → default runner box).
      const preBuilt = config["__imageRef"] as string | undefined;
      const { base: baseRef } = await kitRefs();
      const imageRef = preBuilt ?? baseRef;
      if (!preBuilt) await ensureKitImage(client, baseRef, REGISTRY_AUTH);
      return imageRef;
    },
    onImagePending: async (id) => { if (pool) await markImagePendingIfBuildable(pool, id); },
    verifyImageFresh: async ({ config, storedFingerprint, storedImageRef, log }) => {
      const connection = (config as Record<string, unknown>)["connection"];
      const client = makeDockerClient(connection as Parameters<typeof makeDockerClient>[0]);
      const { bundle } = await kitRefs();
      await ensureKitImage(client, bundle, REGISTRY_AUTH);
      const inputs = await resolveBuildInputs({
        image: (config as Record<string, unknown>)["image"] as never,
        client,
        bundleRef: bundle,
        log,
      });
      const present = await client.imageExists(storedImageRef);
      const fresh = present && inputs.fingerprint === storedFingerprint;
      return {
        fresh,
        ...(fresh
          ? {}
          : { reason: `image drift: expected ${inputs.fingerprint}, have ${storedFingerprint || "none"}${present ? "" : " (image pruned)"}` }),
      };
    },
  },
  windows: {
    makeClient: (connection) => makeWindowsAgentClient(connection),
  },
});

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
            id: w.id,
            type: w.type,
            config: (w.config ?? {}) as Record<string, unknown>,
            imageState: w.imageState,
            imageFingerprint: w.imageFingerprint,
            imageRef: w.imageRef,
            imageError: w.imageError,
          };
        }
        return { id: "local", type: "local" as const, config: {} };
      },
      registry: workerRegistry,
    },
    a,
  );

registry.register(new StartFeatureBranchStepHandler({ coding, ...(pool ? { pool } : {}) }));
registry.register(new ListWorkspaceFilesStepHandler({ coding, ...(pool ? { pool } : {}) }));
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

const git: ProviderFactory<IGitProvider> = (key, env, connection) => {
  const provider = connection?.provider ?? key ?? "github";
  switch (provider) {
    case "github":
      return new GitHubProvider({ token: connection?.credential ?? env.GITHUB_ACCESS_TOKEN });
    case "gitlab":
      return new GitLabProvider({
        token: connection?.credential ?? env.GITLAB_TOKEN,
        baseUrl: (connection?.baseUrl ?? env.GITLAB_BASE_URL) || undefined,
      });
    default: {
      const err = new Error(`Unknown git provider: ${provider}`) as Error & { name: string };
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
if (pool) {
  registry.register(new AgentRunStepHandler({ coding, git, pool, bindingResolver: (input) => cliBindingResolver(input) }));
}

const issue: ProviderFactory<IIssueProvider> = (key, env, connection) => {
  const provider = connection?.provider ?? key ?? "jira";
  switch (provider) {
    case "jira":
      return new JiraProvider({
        apiToken: connection?.credential ?? env.JIRA_API_TOKEN,
        email: (connection?.config?.email as string | undefined) ?? env.JIRA_EMAIL,
        host: (connection?.baseUrl ?? env.JIRA_HOST ?? "").replace(/^https?:\/\//, ""),
      });
    case "github-issues":
      return new GitHubIssuesProvider({ token: connection?.credential ?? env.GITHUB_ACCESS_TOKEN });
    case "github-projects":
      return new GitHubProjectsProvider({ token: connection?.credential ?? env.GITHUB_ACCESS_TOKEN });
    case "linear":
      return new LinearProvider();
    case "monday":
      return new MondayProvider();
    default: {
      const err = new Error(`Unknown issue provider: ${provider}`) as Error & { name: string };
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

const notification: ProviderFactory<INotificationProvider> = (key, _env, connection) => {
  const provider = connection?.provider ?? key ?? "";
  return buildNotificationProvider(
    provider,
    (connection?.config ?? {}) as Record<string, unknown>,
    connection?.credential ?? "",
  );
};
registry.register(new SendMessageStepHandler({ notification }));

// Register matching task definitions (idempotent).
// retryCount here is a catalog-level cap. Per-flow retry policy (defaults.retry)
// sets the actual count per workflow task — it cannot exceed this cap.
// Keeping it at 10 gives flows enough headroom while preventing runaway retries.
async function registerTaskDefs(): Promise<void> {
  // Conductor reads a task's timeout/response-timeout from its registered TaskDef,
  // so the backstop must be set HERE (not only on the per-node workflow task).
  // Size it to outlast the worker's own enforcement — the per-step deadline plus
  // the in-process image-build wait — so the engine never times out a step the
  // worker is still legitimately working on (a slow first image build, a long run).
  // This is per-type so it uses the default (no per-node override); nodes that ask
  // for a longer step timeout still get it raised on the workflow task itself.
  const taskTimeoutSeconds = resolveConductorTaskTimeoutSeconds();
  for (const handler of registry.list()) {
    await client.putTaskDef({
      name: handler.stepType,
      retryCount: 10,
      timeoutSeconds: taskTimeoutSeconds,
      timeoutPolicy: "TIME_OUT_WF",
      retryLogic: "EXPONENTIAL_BACKOFF",
      retryDelaySeconds: 5,
      backoffScaleFactor: 2,
      responseTimeoutSeconds: taskTimeoutSeconds,
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
  ctx: { userId: string | null; orgId: string | null; workflowId: string | null; workspaceId?: string | null };
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
      workspace: ctx.workspaceId
        ? { id: ctx.workspaceId, orgId: ctx.orgId ?? "", role: null, permissions: [] }
        : undefined,
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
// in the run viewer. With no DATABASE_URL (env-only mode) events are dropped.
const noopEventBus: IEventBus = {
  append: async () => undefined as never,
  list: async () => [],
  subscribe: async function* () { /* yields nothing */ },
};
const events: IEventBus = pool ? new PostgresEventBus(pool) : noopEventBus;
if (!pool) {
  log.warn("DATABASE_URL not set — step events are dropped and invisible to the workflow instance viewer");
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
    return resolveMcpInstances(pool, { workspaceId: ctx.workspaceId ?? null }, instanceIds);
  },
  skillsResolver: ({ ctx, packageIds }) => {
    if (!pool) return Promise.resolve([]);
    return resolveSkillPackagesByIds(
      pool,
      { workspaceId: ctx.workspaceId ?? null },
      packageIds,
      "claude",
    );
  },
  modelResolver: async ({ provider, orgId }) => {
    if (!pool || !orgId) return undefined;
    const m = await findDefaultCodingModel(pool, orgId, provider);
    return m?.modelId;
  },
  modelConfigResolver: async ({ provider, modelId, orgId }) => {
    if (!pool || !orgId) return undefined;
    const m = await findCodingModel(pool, orgId, provider, modelId);
    return m?.config;
  },
  modelKeyResolver: async ({ provider, modelId, orgId }) => {
    if (!pool || !orgId) return null;
    const m = await findCodingModel(pool, orgId, provider, modelId);
    if (!m?.apiKeySecretId || !m?.config?.requiresApiKey) return null;
    const value = await fetchSecretById(pool, orgId, m.apiKeySecretId);
    if (value == null) return null;
    const slot = codingModelKeySlot({ provider, config: m.config, modelId });
    return { slot, value };
  },
  ensureWorkspace: ensureWs,
  connectionResolver: pool
    ? async (connectionId: string): Promise<ResolvedConnection> => {
        const conn = await getConnection(pool, connectionId);
        if (!conn) throw Object.assign(new Error(`Connection not found: ${connectionId}`), { name: "ConfigurationError" });
        const sealed = await getConnectionSealed(pool, connectionId);
        if (!sealed) throw Object.assign(new Error(`Connection credential not found: ${connectionId}`), { name: "ConfigurationError" });
        return {
          id: conn.id,
          category: conn.category,
          provider: conn.provider,
          credential: open(sealed),
          baseUrl: conn.baseUrl,
          config: conn.config,
        };
      }
    : undefined,
});

// Spec B: build managed sandbox images ahead of time (this process holds
// the Docker connection). Claims pending targets, builds, marks ready/failed.
const stopBuildLoop = pool
  ? startBuildLoop({
      db: pool,
      // Resolve the kit bundle ref live per tick (not cached at startup) so the
      // builder and the per-run freshness gate fold the SAME bundle into the
      // fingerprint — otherwise a kit republish after boot causes permanent drift.
      bundleRef: () => kitRefs().then((r) => r.bundle),
      kitAuth: REGISTRY_AUTH,
      leaseMs: 120_000,
      intervalMs: 3000,
      log: (line) => log.info({ line }, "build-loop"),
    })
  : () => {};
// Periodically prune orphaned jm-built images (keep set = ready boxes' refs) so
// disk doesn't grow as fingerprints churn. Targets each docker sandbox's daemon (from the DB).
const stopPrune = pool
  ? (() => {
      const timer = setInterval(() => {
        void (async () => {
          try {
            const keep = new Set(await listReadyImageRefs(pool));
            const connections = await listDockerSandboxConnections(pool);
            for (const conn of connections) {
              try {
                const removed = await pruneBuiltImages(
                  makeDockerClient(conn),
                  keep,
                  (line) => log.info({ line }, "prune"),
                );
                if (removed.length) log.info({ removed, host: conn.host }, "pruned orphaned built images");
              } catch (err) {
                log.warn({ err: String(err), host: conn.host }, "prune failed for daemon");
              }
            }
          } catch (err) {
            log.warn({ err: String(err) }, "image prune sweep failed");
          }
        })();
      }, 600_000); // every 10 min
      if ("unref" in timer) (timer as { unref: () => void }).unref();
      return () => clearInterval(timer);
    })()
  : () => {};

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { stopBuildLoop(); stopPrune(); });
}

log.info({ steps: registry.list().map(h => h.stepType) }, "worker starting");
await harness.start(registry.list().map(h => h.stepType));
