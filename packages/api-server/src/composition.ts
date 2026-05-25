// THE WIRING POINT.
//
// This is the only file in the codebase allowed to import concrete adapter
// classes. Every other file depends on the interfaces in @journeyman/core.
//
// Replacing an adapter — e.g. swapping PostgresWorkflowStore for MemoryWorkflowStore
// for tests, or ConductorOrchestrator for a future TemporalOrchestrator —
// MUST require changing only this file. If a swap forces edits anywhere else,
// the boundaries are wrong (see spec §12 "Architectural exit criterion").

import { Pool } from "pg";
import type {
  IAuthProvider, IConditionEvaluator, IEventBus,
  IWorkflowGrantsStore, IWorkflowStore, IWorkflowVersionStore, INodeExecutionStore, IOrchestratorEngine,
  IStepRegistry, IWorkflowInstanceGrantsStore, IWorkflowInstanceStore, IWebhookEventStore, IWebhookStore, IWorkflowTriggerStore, IWorkspaceProvider,
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
  DirectoryWorkspaceProvider,
  InMemoryStepRegistry,
  JsonLogicEvaluator,
  createPool,
  type IHumanTaskResolutionStore,
} from "@journeyman/orchestrator";
import {
  InMemoryHumanTaskTimeoutService,
  type HumanTaskTimeoutService,
} from "./services/human-task-timeout.ts";

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
  conductorClient: ConductorClient;
  orchestrator: IOrchestratorEngine;
  registry: IStepRegistry;
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
  const orchestrator = new ConductorOrchestrator({
    client: conductorClient,
    converter: new ConductorJsonConverter(),
    workflowInstances,
    workflowInstanceGrants,
    events,
  });

  const registry = new InMemoryStepRegistry();
  const workspace = new DirectoryWorkspaceProvider();
  const auth: IAuthProvider = {
    async authenticate(_req: FastifyRequest) {
      return { userId: null, roles: ["anonymous"] };
    },
  };
  const conditions = new JsonLogicEvaluator();

  return {
    workflowGrants, workflowInstanceGrants, workflows, workflowVersions, workflowInstances,
    nodeExecutions, events, webhookEvents, webhooks, workflowTriggers,
    humanTaskResolutions, humanTaskTimeouts, conductorClient,
    orchestrator, registry, workspace, auth, conditions,
    pool,
    shutdown: async () => { if (pool) await pool.end(); },
  };
}
