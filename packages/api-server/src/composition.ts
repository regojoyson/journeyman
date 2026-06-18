// THE WIRING POINT.
//
// This is the only file in the codebase allowed to import concrete adapter
// classes. Every other file depends on the interfaces in @journeyman/core.
//
// Replacing an adapter — e.g. swapping ConductorOrchestrator for a future
// TemporalOrchestrator, or PostgresWorkflowStore for another backend —
// MUST require changing only this file. If a swap forces edits anywhere else,
// the boundaries are wrong (see spec §12 "Architectural exit criterion").

import { join } from "node:path";
import { Pool } from "pg";
import {
  getSandboxInstance, markSandboxInstanceDestroyed, listActiveSandboxInstances,
  createDefaultRegistry, destroySandboxInstance, makeDockerClient, makeWindowsAgentClient,
  SandboxInstanceReaper, type SandboxInstanceRecord, type SandboxInstanceRoutesDeps,
} from "@journeyman/sandbox";
import { isTerminalStatus } from "@journeyman/core";
import type {
  IAuthProvider, IConditionEvaluator, IEventBus,
  IWorkflowGrantsStore, IWorkflowStore, IWorkflowVersionStore, INodeExecutionStore, IOrchestratorEngine,
  IStepRegistry, IWorkflowInstanceGrantsStore, IWorkflowInstanceStore, IWebhookEventStore, IWebhookStore, IWorkflowTriggerStore,
  WorkflowInstanceStatus,
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
  PostgresWorkflowTriggerStore,
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
import { makeNotifyOnTerminal } from "./services/notify-on-terminal.ts";
import { makeRecordTerminalMetrics } from "./services/agent-metrics.ts";

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
  sandboxInstanceRoutesDeps?: SandboxInstanceRoutesDeps;
  /** Closed when the server shuts down. */
  shutdown: () => Promise<void>;
}

export interface CompositionConfig {
  databaseUrl: string;
  conductorBaseUrl: string;
}

export function buildComposition(cfg: CompositionConfig): Composition {
  // Postgres is the only persistence backend. `pool` is typed `Pool | null`
  // so the downstream sandbox-reaper guards (`pool ? … : undefined`) compile
  // unchanged; it is always non-null in practice.
  const pool: Pool | null = createPool({ connectionString: cfg.databaseUrl });
  const v = new PostgresWorkflowVersionStore(pool);
  const workflowVersions: IWorkflowVersionStore = v;
  const workflowGrants: IWorkflowGrantsStore = new PostgresWorkflowGrantsStore(pool);
  const workflowInstanceGrants: IWorkflowInstanceGrantsStore = new PostgresWorkflowInstanceGrantsStore(pool);
  const workflows: IWorkflowStore = new PostgresWorkflowStore(pool, v, workflowGrants);
  const workflowInstances: IWorkflowInstanceStore = new PostgresWorkflowInstanceStore(pool);
  const nodeExecutions: INodeExecutionStore = new PostgresNodeExecutionStore(pool);
  const events: IEventBus = new PostgresEventBus(pool);
  const webhookEvents: IWebhookEventStore = new PostgresWebhookEventStore(pool);
  const webhooks: IWebhookStore = new PostgresWebhookStore(pool);
  const workflowTriggers: IWorkflowTriggerStore = new PostgresWorkflowTriggerStore(pool);
  const humanTaskResolutions: IHumanTaskResolutionStore = new PostgresHumanTaskResolutionStore(pool);

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

  // Teardown-only registry: local backend has no runOperation (destroy is
  // filesystem-only); docker builds a per-connection client. All teardown
  // entrypoints route through the single destroySandboxInstance helper.
  const teardownRegistry = createDefaultRegistry({
    defaultBaseDir: LOCAL_WORKSPACE_BASE,
    docker: {
      makeClient: (connection) => makeDockerClient(connection as Parameters<typeof makeDockerClient>[0]),
      defaultImage: RUNNER_IMAGE,
    },
    windows: { makeClient: (connection) => makeWindowsAgentClient(connection) },
  });

  const destroyByType = (sb: SandboxInstanceRecord): Promise<void> =>
    destroySandboxInstance(teardownRegistry, sb);

  const isRunActive = async (runId: string): Promise<boolean> => {
    const inst = await workflowInstances.getById(runId).catch(() => null);
    return !!inst && !isTerminalStatus(inst.status);
  };
  const logRun = (workflowInstanceId: string, line: string) =>
    events.append({ workflowInstanceId, eventType: "step.log", payload: { line } }).catch(() => undefined);

  // Task 16: eager pre-warm removed — the worker provisions on its first step
  // (provision-if-missing / claimSandboxInstance path in ensureWorkspace). Keeping the
  // function shape as a no-op so the orchestrator wiring is unchanged.
  const sandboxProvisioner = pool
    ? async (_a: { workflowInstanceId: string; sandboxId?: string; userId: string | null; orgId: string | null }) => {
        // No-op: workspace provisioning is now owned by the worker (lazy, status-gated).
        // The ProvisioningReaper (below) detects stuck provisioning via
        // jm_sandbox_instances.status = 'provisioning' + age.
      }
    : undefined;

  const sandboxReaper = pool
    ? async (workflowInstanceId: string) => {
        const sb = await getSandboxInstance(pool!, workflowInstanceId);
        if (!sb || sb.status !== "active") return;
        await destroyByType(sb);
        await markSandboxInstanceDestroyed(pool!, workflowInstanceId);
        await logRun(workflowInstanceId, "Sandbox destroyed");
      }
    : undefined;

  const sandboxInstanceRoutesDeps: SandboxInstanceRoutesDeps | undefined = pool ? { destroy: destroyByType, isRunActive } : undefined;
  let reaperStop: (() => void) | undefined;
  if (pool) {
    const reaper = new SandboxInstanceReaper({
      listActive: () => listActiveSandboxInstances(pool!),
      isRunActive,
      destroy: destroyByType,
      markDestroyed: (id) => markSandboxInstanceDestroyed(pool!, id),
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
    ...(pool
      ? {
          notifyOnTerminal: (() => {
            const notify = makeNotifyOnTerminal({ pool, workflowInstances });
            const metrics = makeRecordTerminalMetrics({ pool, workflowInstances });
            return async (id: string, status: WorkflowInstanceStatus) => {
              await metrics(id, status);
              await notify(id, status);
            };
          })(),
        }
      : {}),
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
    ...(sandboxInstanceRoutesDeps ? { sandboxInstanceRoutesDeps } : {}),
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
