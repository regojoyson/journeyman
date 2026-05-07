// THE WIRING POINT.
//
// This is the only file in the codebase allowed to import concrete adapter
// classes. Every other file depends on the interfaces in @journeyman/core.
//
// Replacing an adapter — e.g. swapping PostgresFlowStore for MemoryFlowStore
// for tests, or ConductorOrchestrator for a future TemporalOrchestrator —
// MUST require changing only this file. If a swap forces edits anywhere else,
// the boundaries are wrong (see spec §12 "Architectural exit criterion").

import { Pool } from "pg";
import type {
  IAuthProvider, IConditionEvaluator, IEventBus,
  IFlowGrantsStore, IFlowStore, IFlowVersionStore, INodeExecutionStore, IOrchestratorEngine,
  IPhaseRegistry, IRunGrantsStore, IRunStore, IWebhookEventStore, IWorkspaceProvider,
} from "@journeyman/core";
import type { FastifyRequest } from "fastify";
import {
  ConductorClient,
  ConductorOrchestrator,
  ConductorJsonConverter,
  PostgresFlowGrantsStore,
  PostgresRunGrantsStore,
  PostgresFlowStore,
  PostgresFlowVersionStore,
  PostgresRunStore,
  PostgresNodeExecutionStore,
  PostgresEventBus,
  PostgresWebhookEventStore,
  PostgresHumanTaskResolutionStore,
  MemoryFlowGrantsStore,
  MemoryRunGrantsStore,
  MemoryFlowStore,
  MemoryFlowVersionStore,
  MemoryRunStore,
  MemoryNodeExecutionStore,
  MemoryEventBus,
  MemoryWebhookEventStore,
  MemoryHumanTaskResolutionStore,
  DirectoryWorkspaceProvider,
  InMemoryPhaseRegistry,
  JsonLogicEvaluator,
  createPool,
  type IHumanTaskResolutionStore,
} from "@journeyman/orchestrator";
import {
  InMemoryHumanTaskTimeoutService,
  type HumanTaskTimeoutService,
} from "./services/human-task-timeout.ts";

export interface Composition {
  flowGrants: IFlowGrantsStore;
  runGrants: IRunGrantsStore;
  flows: IFlowStore;
  flowVersions: IFlowVersionStore;
  runs: IRunStore;
  nodeExecutions: INodeExecutionStore;
  events: IEventBus;
  webhookEvents: IWebhookEventStore;
  humanTaskResolutions: IHumanTaskResolutionStore;
  humanTaskTimeouts: HumanTaskTimeoutService;
  conductorClient: ConductorClient;
  orchestrator: IOrchestratorEngine;
  registry: IPhaseRegistry;
  workspace: IWorkspaceProvider;
  auth: IAuthProvider;
  conditions: IConditionEvaluator;
  /** The pg Pool (null when using the memory backend). */
  pool: Pool | null;
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

  let flowGrants: IFlowGrantsStore;
  let runGrants: IRunGrantsStore;
  let flows: IFlowStore;
  let flowVersions: IFlowVersionStore;
  let runs: IRunStore;
  let nodeExecutions: INodeExecutionStore;
  let events: IEventBus;
  let webhookEvents: IWebhookEventStore;
  let humanTaskResolutions: IHumanTaskResolutionStore;
  let pool: Pool | null = null;

  if (useMemory) {
    const v = new MemoryFlowVersionStore();
    flowVersions = v;
    flowGrants = new MemoryFlowGrantsStore();
    runGrants = new MemoryRunGrantsStore();
    flows = new MemoryFlowStore(v, flowGrants);
    runs = new MemoryRunStore();
    nodeExecutions = new MemoryNodeExecutionStore();
    events = new MemoryEventBus();
    webhookEvents = new MemoryWebhookEventStore();
    humanTaskResolutions = new MemoryHumanTaskResolutionStore();
  } else {
    pool = createPool({ connectionString: cfg.databaseUrl });
    const v = new PostgresFlowVersionStore(pool);
    flowVersions = v;
    flowGrants = new PostgresFlowGrantsStore(pool);
    runGrants = new PostgresRunGrantsStore(pool);
    flows = new PostgresFlowStore(pool, v, flowGrants);
    runs = new PostgresRunStore(pool);
    nodeExecutions = new PostgresNodeExecutionStore(pool);
    events = new PostgresEventBus(pool);
    webhookEvents = new PostgresWebhookEventStore(pool);
    humanTaskResolutions = new PostgresHumanTaskResolutionStore(pool);
  }

  const humanTaskTimeouts: HumanTaskTimeoutService = new InMemoryHumanTaskTimeoutService();

  const conductorClient = new ConductorClient({ baseUrl: cfg.conductorBaseUrl });
  const orchestrator = new ConductorOrchestrator({
    client: conductorClient,
    converter: new ConductorJsonConverter(),
    runs,
    runGrants,
  });

  const registry = new InMemoryPhaseRegistry();
  const workspace = new DirectoryWorkspaceProvider();
  // Inline anonymous auth provider
  const auth: IAuthProvider = {
    async authenticate(_req: FastifyRequest) {
      return { userId: null, roles: ["anonymous"] };
    },
  };
  const conditions = new JsonLogicEvaluator();

  return {
    flowGrants, runGrants, flows, flowVersions, runs, nodeExecutions, events, webhookEvents,
    humanTaskResolutions, humanTaskTimeouts, conductorClient,
    orchestrator, registry, workspace, auth, conditions,
    pool,
    shutdown: async () => { if (pool) await pool.end(); },
  };
}
