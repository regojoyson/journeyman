// Interfaces
export type { ICodingCLI } from "./interfaces/coding-cli.interface.ts";
export type { IGitProvider } from "./interfaces/git-provider.interface.ts";
export type { ITicketProvider } from "./interfaces/ticket.interface.ts";
export type { INotificationProvider } from "./interfaces/notification.interface.ts";

// Types
export type * from "./types/git.types.ts";
export type * from "./types/coding.types.ts";
export type * from "./types/ticket.types.ts";
export type * from "./types/notification.types.ts";
export type * from "./types/session.types.ts";
export type * from "./types/pipeline.types.ts";
// Logger
export { createLogger, type Logger } from "./logger.ts";

export type {
  PipelineContext,
  IPhase,
  IStateStore,
  ITraceLogger,
  IArtifactStore,
  IFlowConfigSource,
  IFlowResolver,
  ITriggerSource,
  TriggerMountContext,
} from "./interfaces/pipeline.interface.ts";

// === Phase 1 adapter surface ===
export type {
  IOrchestratorEngine, SubmitRunArgs,
} from "./interfaces/orchestrator-engine.interface.ts";
export type {
  IFlowStore, IFlowVersionStore, CreateFlowArgs,
} from "./interfaces/flow-store.interface.ts";
export type {
  IRunStore, INodeExecutionStore, CreateRunArgs,
} from "./interfaces/run-store.interface.ts";
export type {
  IEventBus, AppendEventArgs,
} from "./interfaces/event-bus.interface.ts";
export type {
  IPhaseHandler, IPhaseRegistry, PhaseRunResult,
} from "./interfaces/phase-registry.interface.ts";
export type {
  IWorkspace, IWorkspaceProvider,
} from "./interfaces/workspace-provider.interface.ts";
export type {
  ICredentialStore, CredentialRef,
} from "./interfaces/credential-store.interface.ts";
export { CredentialNotFoundError } from "./interfaces/credential-store.interface.ts";
export type { IConditionEvaluator } from "./interfaces/condition-evaluator.interface.ts";
export type { IAuthProvider, IUserContext } from "./interfaces/auth-provider.interface.ts";
export type { IFlowJsonConverter } from "./interfaces/flow-json-converter.interface.ts";

// === Phase 1 data types ===
export type {
  Flow, FlowGraph, FlowEdge, FlowEdgeType, FlowNode, FlowNodeType, FlowVersion,
  FlowSchemaVersion,
  RetryPolicy, FlowRetryPolicy, BackoffStrategy,
  McpServerConfig, McpTransport, NodeInputBinding,
} from "./types/flow.types.ts";
export { FLOW_SCHEMA_VERSION } from "./types/flow.types.ts";
export type {
  Run, RunEvent, RunEventType, RunStatus, TriggerSource,
  NodeExecution, NodeExecutionStatus,
} from "./types/run.types.ts";
export type {
  PhaseContext, PhaseFailure, PhaseInput, PhaseOutput,
} from "./types/phase-handler.types.ts";
