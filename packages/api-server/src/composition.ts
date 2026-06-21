// THE WIRING POINT.
//
// This is the only file in the codebase allowed to import concrete adapter
// classes. Every other file depends on the interfaces in @journeyman/core.
//
// buildComposition() is PURE: it constructs stores + the orchestrator and
// returns them. It starts NO background loops — those are owned by the
// control-plane process (see @journeyman/api-control-plane startControlPlane).

import { join } from "node:path";
import { Pool } from "pg";
import {
  getSandboxInstance, markSandboxInstanceDestroyed, listActiveSandboxInstances,
  createDefaultRegistry, destroySandboxInstance, makeDockerClient, makeWindowsAgentClient,
  type SandboxInstanceRecord, type SandboxInstanceRoutesDeps,
} from "@journeyman/sandbox";
import { isTerminalStatus } from "@journeyman/core";
import type {
  IAuthProvider, IConditionEvaluator, IEventBus,
  IWorkflowStore, IWorkflowVersionStore, INodeExecutionStore, IOrchestratorEngine,
  IStepRegistry, IWorkflowInstanceStore, IWebhookEventStore, IWebhookStore, IWorkflowTriggerStore,
  WorkflowInstanceStatus,
} from "@journeyman/core";
import type { FastifyRequest } from "fastify";
import {
  ConductorClient,
  ConductorOrchestrator,
  ConductorJsonConverter,
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
  type IHumanTaskResolutionStore,
} from "@journeyman/orchestrator";
import type { Composition, CompositionConfig } from "@journeyman/api-context";
import { InMemoryHumanTaskTimeoutService } from "@journeyman/api-context";
import { makeNotifyOnTerminal, makeRecordTerminalMetrics } from "@journeyman/api-control-plane";

export type { Composition, CompositionConfig } from "@journeyman/api-context";

export function buildComposition(cfg: CompositionConfig): Composition {
  // Postgres is the only persistence backend. `pool` is typed `Pool | null`
  // so the downstream sandbox-reaper guards (`pool ? … : undefined`) compile
  // unchanged; it is always non-null in practice.
  const pool: Pool | null = createPool({ connectionString: cfg.databaseUrl });
  const v = new PostgresWorkflowVersionStore(pool);
  const workflowVersions: IWorkflowVersionStore = v;
  const workflows: IWorkflowStore = new PostgresWorkflowStore(pool, v);
  const workflowInstances: IWorkflowInstanceStore = new PostgresWorkflowInstanceStore(pool);
  const nodeExecutions: INodeExecutionStore = new PostgresNodeExecutionStore(pool);
  const events: IEventBus = new PostgresEventBus(pool);
  const webhookEvents: IWebhookEventStore = new PostgresWebhookEventStore(pool);
  const webhooks: IWebhookStore = new PostgresWebhookStore(pool);
  const workflowTriggers: IWorkflowTriggerStore = new PostgresWorkflowTriggerStore(pool);
  const humanTaskResolutions: IHumanTaskResolutionStore = new PostgresHumanTaskResolutionStore(pool);

  const humanTaskTimeouts = new InMemoryHumanTaskTimeoutService();

  const conductorClient = new ConductorClient({ baseUrl: cfg.conductorBaseUrl });

  // Sandbox provision/teardown — active only when a pg pool exists. A `local`
  // worker (the default) is a no-op, preserving today's in-process behavior.
  const RUNNER_IMAGE = process.env.JOURNEYMAN_RUNNER_IMAGE ?? "journeyman/runner-base:dev";

  // Local workspace base dir — used by the api-server reaper's local destroy path.
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

  // Eager pre-warm removed — the worker provisions on its first step. Keeping
  // the function shape as a no-op so the orchestrator wiring is unchanged.
  const sandboxProvisioner = pool
    ? async (_a: { workflowInstanceId: string; sandboxId?: string; userId: string | null; orgId: string | null }) => {
        // No-op: workspace provisioning is owned by the worker (lazy, status-gated).
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
  // listActiveSandboxInstances is consumed by the control-plane reaper
  // (startControlPlane); it is intentionally NOT started here.
  void listActiveSandboxInstances;

  const orchestrator: IOrchestratorEngine = new ConductorOrchestrator({
    client: conductorClient,
    converter: new ConductorJsonConverter(),
    workflowInstances,
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
    workflows, workflowVersions, workflowInstances,
    nodeExecutions, events, webhookEvents, webhooks, workflowTriggers,
    humanTaskResolutions, humanTaskTimeouts, conductorClient,
    orchestrator, registry, auth, conditions,
    pool,
    ...(sandboxInstanceRoutesDeps ? { sandboxInstanceRoutesDeps } : {}),
    shutdown: async () => { if (pool) await pool.end(); },
  };

  return composition;
}
