import type { Pool } from "pg";
import type {
  IAuthProvider, IConditionEvaluator, IEventBus,
  IWorkflowStore, IWorkflowVersionStore, INodeExecutionStore, IOrchestratorEngine,
  IStepRegistry, IWorkflowInstanceStore, IWebhookEventStore, IWebhookStore, IWorkflowTriggerStore,
} from "@journeyman/core";
import type { ConductorClient, IHumanTaskResolutionStore } from "@journeyman/orchestrator";
import type { SandboxInstanceRoutesDeps } from "@journeyman/sandbox";
import type { HumanTaskTimeoutService } from "./services/human-task-timeout.ts";

export interface Composition {
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
