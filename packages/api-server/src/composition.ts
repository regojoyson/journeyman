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
  IAuthProvider, IConditionEvaluator, ICredentialStore, IEventBus,
  IFlowStore, IFlowVersionStore, INodeExecutionStore, IOrchestratorEngine,
  IPhaseRegistry, IRunStore, IWorkspaceProvider,
} from "@journeyman/core";
import type { FastifyRequest } from "fastify";
import {
  ConductorClient,
  ConductorOrchestrator,
  ConductorJsonConverter,
  PostgresFlowStore,
  PostgresFlowVersionStore,
  PostgresRunStore,
  PostgresNodeExecutionStore,
  PostgresEventBus,
  MemoryFlowStore,
  MemoryFlowVersionStore,
  MemoryRunStore,
  MemoryNodeExecutionStore,
  MemoryEventBus,
  EnvCredentialStore,
  DirectoryWorkspaceProvider,
  InMemoryPhaseRegistry,
  JsonLogicEvaluator,
  createPool,
} from "@journeyman/orchestrator";

export interface Composition {
  flows: IFlowStore;
  flowVersions: IFlowVersionStore;
  runs: IRunStore;
  nodeExecutions: INodeExecutionStore;
  events: IEventBus;
  orchestrator: IOrchestratorEngine;
  registry: IPhaseRegistry;
  workspace: IWorkspaceProvider;
  credentials: ICredentialStore;
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

  let flows: IFlowStore;
  let flowVersions: IFlowVersionStore;
  let runs: IRunStore;
  let nodeExecutions: INodeExecutionStore;
  let events: IEventBus;
  let pool: Pool | null = null;

  if (useMemory) {
    const v = new MemoryFlowVersionStore();
    flowVersions = v;
    flows = new MemoryFlowStore(v);
    runs = new MemoryRunStore();
    nodeExecutions = new MemoryNodeExecutionStore();
    events = new MemoryEventBus();
  } else {
    pool = createPool({ connectionString: cfg.databaseUrl });
    const v = new PostgresFlowVersionStore(pool);
    flowVersions = v;
    flows = new PostgresFlowStore(pool, v);
    runs = new PostgresRunStore(pool);
    nodeExecutions = new PostgresNodeExecutionStore(pool);
    events = new PostgresEventBus(pool);
  }

  const conductorClient = new ConductorClient({ baseUrl: cfg.conductorBaseUrl });
  const orchestrator = new ConductorOrchestrator({
    client: conductorClient,
    converter: new ConductorJsonConverter(),
    runs,
  });

  const registry = new InMemoryPhaseRegistry();
  const workspace = new DirectoryWorkspaceProvider();
  const credentials = new EnvCredentialStore();
  // Inline anonymous auth provider
  const auth: IAuthProvider = {
    async authenticate(_req: FastifyRequest) {
      return { userId: null, roles: ["anonymous"] };
    },
  };
  const conditions = new JsonLogicEvaluator();

  return {
    flows, flowVersions, runs, nodeExecutions, events,
    orchestrator, registry, workspace, credentials, auth, conditions,
    pool,
    shutdown: async () => { if (pool) await pool.end(); },
  };
}
