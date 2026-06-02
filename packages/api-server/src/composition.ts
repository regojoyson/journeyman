// THE WIRING POINT.
//
// This is the only file in the codebase allowed to import concrete adapter
// classes. Every other file depends on the interfaces in @journeyman/core.
//
// Replacing an adapter — e.g. swapping PostgresWorkflowStore for MemoryWorkflowStore
// for tests, or ConductorOrchestrator for a future TemporalOrchestrator —
// MUST require changing only this file. If a swap forces edits anywhere else,
// the boundaries are wrong (see spec §12 "Architectural exit criterion").

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import {
  getSandbox, markSandboxDestroyed, listActiveSandboxes,
  DockerExecutionEnvironment, makeDockerClient,
  SandboxReaper, type SandboxRecord, type SandboxRoutesDeps,
} from "@journeyman/workers";
import { isTerminalStatus } from "@journeyman/core";
import type {
  IAuthProvider, IConditionEvaluator, IEventBus,
  IWorkflowGrantsStore, IWorkflowStore, IWorkflowVersionStore, INodeExecutionStore, IOrchestratorEngine,
  IStepRegistry, IWorkflowInstanceGrantsStore, IWorkflowInstanceStore, IWebhookEventStore, IWebhookStore, IWorkflowTriggerStore,
} from "@journeyman/core";
import type { FastifyRequest } from "fastify";
import {
  ConductorClient,
  ConductorOrchestrator,
  ConductorJsonConverter,
  PostgresWorkflowGrantsStore,
  PostgresWorkflowInstanceGrantsStore,
  PostgresWorkflowStore,
  PostgresWorkflowVersionStore,
  PostgresWorkflowInstanceStore,
  PostgresNodeExecutionStore,
  PostgresEventBus,
  PostgresWebhookEventStore,
  PostgresWebhookStore,
  PostgresHumanTaskResolutionStore,
  MemoryWorkflowGrantsStore,
  MemoryWorkflowInstanceGrantsStore,
  MemoryWorkflowStore,
  MemoryWorkflowVersionStore,
  MemoryWorkflowInstanceStore,
  MemoryNodeExecutionStore,
  MemoryEventBus,
  MemoryWebhookEventStore,
  MemoryWebhookStore,
  MemoryWorkflowTriggerStore,
  PostgresWorkflowTriggerStore,
  MemoryHumanTaskResolutionStore,
  InMemoryStepRegistry,
  JsonLogicEvaluator,
  createPool,
  ProvisioningReaper,
  findStuckProvisioningRuns,
  type IHumanTaskResolutionStore,
} from "@journeyman/orchestrator";
import {
  InMemoryHumanTaskTimeoutService,
  type HumanTaskTimeoutService,
} from "./services/human-task-timeout.ts";
import { WebhookWaitSweeper } from "./services/webhook-wait-sweeper.ts";
import { parseDurationMs } from "./services/parse-duration.ts";
import { resolveHumanTask } from "./services/resolve-human-task.ts";

export interface Composition {
  workflowGrants: IWorkflowGrantsStore;
  workflowInstanceGrants: IWorkflowInstanceGrantsStore;
  workflows: IWorkflowStore;
  workflowVersions: IWorkflowVersionStore;
  workflowInstances: IWorkflowInstanceStore;
  nodeExecutions: INodeExecutionStore;
  events: IEventBus;
  webhookEvents: IWebhookEventStore;
  webhooks: IWebhookStore;
  workflowTriggers: IWorkflowTriggerStore;
  humanTaskResolutions: IHumanTaskResolutionStore;
  humanTaskTimeouts: HumanTaskTimeoutService;
  webhookWaitSweeper: WebhookWaitSweeper;
  conductorClient: ConductorClient;
  orchestrator: IOrchestratorEngine;
  registry: IStepRegistry;
  auth: IAuthProvider;
  conditions: IConditionEvaluator;
  /** The pg Pool (null when using the memory backend). */
  pool: Pool | null;
  /** Deps for the manual sandbox-cleanup routes (null when no pool). */
  sandboxRoutesDeps?: SandboxRoutesDeps;
  /** Closed when the server shuts down. */
  shutdown: () => Promise<void>;
}

export interface CompositionConfig {
  databaseUrl: string;
  conductorBaseUrl: string;
  /** "postgres" (production) or "memory" (tests, demos). Default postgres. */
  storeBackend?: "postgres" | "memory";
}

export function buildComposition(cfg: CompositionConfig): Composition {
  const useMemory = cfg.storeBackend === "memory";

  let workflowGrants: IWorkflowGrantsStore;
  let workflowInstanceGrants: IWorkflowInstanceGrantsStore;
  let workflows: IWorkflowStore;
  let workflowVersions: IWorkflowVersionStore;
  let workflowInstances: IWorkflowInstanceStore;
  let nodeExecutions: INodeExecutionStore;
  let events: IEventBus;
  let webhookEvents: IWebhookEventStore;
  let webhooks: IWebhookStore;
  let workflowTriggers: IWorkflowTriggerStore;
  let humanTaskResolutions: IHumanTaskResolutionStore;
  let pool: Pool | null = null;

  if (useMemory) {
    const v = new MemoryWorkflowVersionStore();
    workflowVersions = v;
    workflowGrants = new MemoryWorkflowGrantsStore();
    workflowInstanceGrants = new MemoryWorkflowInstanceGrantsStore();
    workflows = new MemoryWorkflowStore(v, workflowGrants);
    const memoryInstances = new MemoryWorkflowInstanceStore();
    workflowInstances = memoryInstances;
    nodeExecutions = new MemoryNodeExecutionStore(memoryInstances);
    events = new MemoryEventBus();
    webhookEvents = new MemoryWebhookEventStore();
    webhooks = new MemoryWebhookStore();
    workflowTriggers = new MemoryWorkflowTriggerStore();
    humanTaskResolutions = new MemoryHumanTaskResolutionStore();
  } else {
    pool = createPool({ connectionString: cfg.databaseUrl });
    const v = new PostgresWorkflowVersionStore(pool);
    workflowVersions = v;
    workflowGrants = new PostgresWorkflowGrantsStore(pool);
    workflowInstanceGrants = new PostgresWorkflowInstanceGrantsStore(pool);
    workflows = new PostgresWorkflowStore(pool, v, workflowGrants);
    workflowInstances = new PostgresWorkflowInstanceStore(pool);
    nodeExecutions = new PostgresNodeExecutionStore(pool);
    events = new PostgresEventBus(pool);
    webhookEvents = new PostgresWebhookEventStore(pool);
    webhooks = new PostgresWebhookStore(pool);
    workflowTriggers = new PostgresWorkflowTriggerStore(pool);
    humanTaskResolutions = new PostgresHumanTaskResolutionStore(pool);
  }

  const humanTaskTimeouts: HumanTaskTimeoutService = new InMemoryHumanTaskTimeoutService();

  const conductorClient = new ConductorClient({ baseUrl: cfg.conductorBaseUrl });

  // Sandbox provision/teardown — active only when a pg pool exists. A `local`
  // worker (the default) is a no-op, preserving today's in-process behavior.
  const RUNNER_IMAGE = process.env.JOURNEYMAN_RUNNER_IMAGE ?? "journeyman/runner-base:dev";

  // Local workspace base dir — used by the api-server reaper's local destroy path.
  // Worker-owned local workspaces live under this dir (best-effort; if unreachable
  // the rm is a silent no-op due to `force: true`).
  const LOCAL_WORKSPACE_BASE = process.env.JOURNEYMAN_WORKSPACE_BASE_DIR
    ?? join(process.cwd(), ".journeyman", "workspaces");

  const dockerDestroy = async (sb: SandboxRecord): Promise<void> => {
    const client = makeDockerClient(sb.connection ?? { kind: "local" });
    const env = new DockerExecutionEnvironment({ client, defaultImage: RUNNER_IMAGE });
    await env.destroy({ runId: sb.runId, type: "docker", handle: sb.handle, volume: sb.volume ?? undefined, workspaceDir: "/workspace" });
  };

  /**
   * Type-dispatched sandbox destroyer used by both the per-run reaper and the
   * periodic SandboxReaper.
   *
   * - docker: delegate to dockerDestroy (container + volume teardown).
   * - local: rm -rf the run dir under LOCAL_WORKSPACE_BASE, unless retainWorkspace
   *   is set on the record (best-effort; the worker-host sweep in the worker handles
   *   local orphans authoritatively — this path only runs on the owning host).
   */
  const destroyByType = async (sb: SandboxRecord): Promise<void> => {
    if (sb.type === "docker") return dockerDestroy(sb);
    if (sb.type === "local") {
      // retainWorkspace is a worker-config flag; it is not stored on the sandbox
      // record today. If it were ever persisted here, honour it.
      if ((sb as unknown as { retainWorkspace?: boolean }).retainWorkspace) return;
      await rm(join(LOCAL_WORKSPACE_BASE, sb.runId), { recursive: true, force: true });
    }
    // Other types (ecs, ec2, …): no-op until implemented.
  };

  const isRunActive = async (runId: string): Promise<boolean> => {
    const inst = await workflowInstances.getById(runId).catch(() => null);
    return !!inst && !isTerminalStatus(inst.status);
  };
  const logRun = (workflowInstanceId: string, line: string) =>
    events.append({ workflowInstanceId, eventType: "step.log", payload: { line } }).catch(() => undefined);

  // Task 16: eager pre-warm removed — the worker provisions on its first step
  // (provision-if-missing / claimSandbox path in ensureWorkspace). Keeping the
  // function shape as a no-op so the orchestrator wiring is unchanged.
  const sandboxProvisioner = pool
    ? async (_a: { workflowInstanceId: string; workerId?: string; userId: string | null; orgId: string | null }) => {
        // No-op: workspace provisioning is now owned by the worker (lazy, status-gated).
        // The ProvisioningReaper (below) detects stuck provisioning via
        // jm_sandbox_instances.status = 'provisioning' + age.
      }
    : undefined;

  const sandboxReaper = pool
    ? async (workflowInstanceId: string) => {
        const sb = await getSandbox(pool!, workflowInstanceId);
        if (!sb || sb.status !== "active") return;
        await destroyByType(sb);
        await markSandboxDestroyed(pool!, workflowInstanceId);
        await logRun(workflowInstanceId, "Sandbox destroyed");
      }
    : undefined;

  const sandboxRoutesDeps: SandboxRoutesDeps | undefined = pool ? { destroy: dockerDestroy, isRunActive } : undefined;
  let reaperStop: (() => void) | undefined;
  if (pool) {
    const reaper = new SandboxReaper({
      listActive: () => listActiveSandboxes(pool!),
      isRunActive,
      destroy: destroyByType,
      markDestroyed: (id) => markSandboxDestroyed(pool!, id),
    });
    reaperStop = reaper.start(Number(process.env.SANDBOX_REAP_INTERVAL_MS ?? 60_000));
  }

  let provisioningReaperStop: (() => void) | undefined;
  if (pool) {
    const PROVISION_TIMEOUT_MS = Number(process.env.PROVISION_TIMEOUT_MS ?? 600_000);
    const provisioningReaper = new ProvisioningReaper({
      findStuck: () => findStuckProvisioningRuns(pool!, PROVISION_TIMEOUT_MS),
      failRun: async (id) => {
        await events
          .append({ workflowInstanceId: id, eventType: "step.log", payload: { line: "Run failed: sandbox provisioning timed out" } })
          .catch(() => undefined);
        await workflowInstances.setStatus(id, "failed", { completedAt: new Date() });
      },
    });
    provisioningReaperStop = provisioningReaper.start(Number(process.env.PROVISION_REAP_INTERVAL_MS ?? 60_000));
  }

  const orchestrator = new ConductorOrchestrator({
    client: conductorClient,
    converter: new ConductorJsonConverter(),
    workflowInstances,
    workflowInstanceGrants,
    events,
    ...(sandboxProvisioner ? { sandboxProvisioner } : {}),
    ...(sandboxReaper ? { sandboxReaper } : {}),
  });

  const registry = new InMemoryStepRegistry();
  const auth: IAuthProvider = {
    async authenticate(_req: FastifyRequest) {
      return { userId: null, roles: ["anonymous"] };
    },
  };
  const conditions = new JsonLogicEvaluator();

  const composition: Composition = {
    workflowGrants, workflowInstanceGrants, workflows, workflowVersions, workflowInstances,
    nodeExecutions, events, webhookEvents, webhooks, workflowTriggers,
    humanTaskResolutions, humanTaskTimeouts, conductorClient,
    orchestrator, registry, auth, conditions,
    pool,
    ...(sandboxRoutesDeps ? { sandboxRoutesDeps } : {}),
    // webhookWaitSweeper assigned below — needs the composition reference for its fire-handler.
    webhookWaitSweeper: null as unknown as WebhookWaitSweeper,
    shutdown: async () => { reaperStop?.(); provisioningReaperStop?.(); if (pool) await pool.end(); },
  };

  const maxAgeStr = (process.env.JOURNEYMAN_WEBHOOK_WAIT_MAX_AGE ?? "30d").trim();
  const intervalStr = (process.env.JOURNEYMAN_WEBHOOK_WAIT_SWEEP_INTERVAL ?? "5m").trim();

  const sweeperDisabled = maxAgeStr === "" || maxAgeStr.toLowerCase() === "off";
  const maxAgeMs = sweeperDisabled ? 0 : parseDurationMs(maxAgeStr);
  if (!sweeperDisabled && maxAgeMs === 0) {
    throw new Error(
      `Invalid JOURNEYMAN_WEBHOOK_WAIT_MAX_AGE: "${maxAgeStr}". Use a duration like "30d", "12h", "90m", or "off".`,
    );
  }
  const intervalMs = parseDurationMs(intervalStr) || 5 * 60_000;

  composition.webhookWaitSweeper = new WebhookWaitSweeper({
    maxAgeMs,
    intervalMs,
    batchSize: 500,
    nodeExecutions,
    workflowInstances,
    fire: async ({ workflowInstanceId, nodeId, defaults }) => {
      try {
        await resolveHumanTask(composition, {
          workflowInstanceId,
          nodeId,
          values: defaults,
          payload: {},
          actor: null,
          source: "timeout",
          resolvedBy: "max_age_sweep",
        });
      } catch {
        // Already resolved by webhook/manual or instance cancelled — not an error.
      }
    },
  });

  return composition;
}
