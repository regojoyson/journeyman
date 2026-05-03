// Interfaces
export type { ICodingCLI } from "./interfaces/coding-cli.interface.ts";
export type { IGitProvider } from "./interfaces/git-provider.interface.ts";
export type { IIssueProvider } from "./interfaces/issue.interface.ts";
export type { INotificationProvider } from "./interfaces/notification.interface.ts";

// Types
export type * from "./types/git.types.ts";
export type * from "./types/coding.types.ts";
export type * from "./types/issue.types.ts";
export type * from "./types/notification.types.ts";
export type * from "./types/session.types.ts";
export type * from "./types/pipeline.types.ts";
export type * from "./types/secret-slot.types.ts";
export * from "./types/identity.types.ts";
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
  IPauseableEngine, IRetryableEngine,
} from "./interfaces/orchestrator-capabilities.interface.ts";
export {
  isPauseableEngine, isRetryableEngine,
} from "./interfaces/orchestrator-capabilities.interface.ts";
export type {
  IFlowStore, IFlowVersionStore, IFlowGrantsStore,
  CreateFlowArgs, FlowListFilter, CreateGrantArgs,
} from "./interfaces/flow-store.interface.ts";
export type {
  IRunStore, INodeExecutionStore, CreateRunArgs,
} from "./interfaces/run-store.interface.ts";
export type { IRunGrantsStore } from "./interfaces/run-grants-store.interface.ts";
export type {
  IEventBus, AppendEventArgs,
} from "./interfaces/event-bus.interface.ts";
export type {
  IPhaseHandler, IPhaseRegistry, PhaseRunResult,
} from "./interfaces/phase-registry.interface.ts";
export type {
  IWorkspace, IWorkspaceProvider,
} from "./interfaces/workspace-provider.interface.ts";
export type { IConditionEvaluator } from "./interfaces/condition-evaluator.interface.ts";
export type { IAuthProvider, IUserContext } from "./interfaces/auth-provider.interface.ts";
export type { IFlowJsonConverter } from "./interfaces/flow-json-converter.interface.ts";
export type { ProviderResolver, ProviderFactory } from "./interfaces/provider-resolver.interface.ts";

export {
  PROVIDER_CATALOG,
  providersForKind,
  implementedProvidersForKind,
  defaultProviderForKind,
  PHASE_KIND_MAP,
  kindForPhaseType,
} from "./registries/provider-catalog.ts";
export type { ProviderEntry } from "./registries/provider-catalog.ts";
// Aliased to avoid colliding with flow-editor's own ExecutorKind (which includes "control").
export type { ExecutorKind as CoreExecutorKind } from "./registries/provider-catalog.ts";

// === Phase 1 data types ===
export type {
  Flow, FlowGraph, FlowEdge, FlowEdgeType, FlowNode, FlowNodeType, FlowVersion,
  FlowSchemaVersion,
  RetryPolicy, FlowRetryPolicy, BackoffStrategy,
  McpServerConfig, McpTransport, FlowInputValue, RunInputDef,
  FlowSaveWarning,
  SecretBinding,
  FlowDefaults,
} from "./types/flow.types.ts";
export { FLOW_SCHEMA_VERSION } from "./types/flow.types.ts";
export type {
  FlowScope, FlowGrantPrincipalType, FlowGrantRole, FlowGrant,
} from "./types/flow.types.ts";
export type {
  RunGrant, RunGrantPrincipalType, RunGrantRole,
  CreateRunGrantArgs, ActorContext, RunListScope,
} from "./types/run-grants.types.ts";
export type {
  Run, RunEvent, RunEventType, RunStatus, TriggerSource,
  NodeExecution, NodeExecutionStatus,
} from "./types/run.types.ts";
export { effectiveRole, hasAtLeast } from "./auth/grant-matcher.ts";
export type { GrantLike } from "./auth/grant-matcher.ts";
export type {
  PhaseContext, PhaseFailure, PhaseInput, PhaseOutput,
  OutputSchema,
} from "./types/phase-handler.types.ts";
export type { Shape, InputField, InputFields } from "./types/shape.types.ts";
export {
  IssueShape, RepoShape, PullRequestShape, WorkspaceShape,
  NAMED_SHAPES, resolveShape, shapesEqual, shapeAtPath,
} from "./types/shapes.ts";
export * from "./types/secrets.types.ts";
export { buildIssueRef, parseIssueRef } from "./utils/issue-ref.ts";
export type { IssueRefProvider, ParsedIssueRef } from "./utils/issue-ref.ts";
export { formatIssueForPrompt, isIssueLike } from "./utils/format-issue.ts";
export {
  validateInputBinding,
  validateFlowInputs,
  shapeTag,
} from "./utils/validate-flow.ts";
export type {
  BindingCheck,
  ValidationCatalog,
  ValidationCatalogEntry,
} from "./utils/validate-flow.ts";
export type {
  WebhookEvent,
  WebhookEventStatus,
  WebhookProvider,
  CreateWebhookEventArgs,
} from "./types/webhook.types.ts";
export type { IWebhookEventStore } from "./interfaces/webhook-event-store.interface.ts";
