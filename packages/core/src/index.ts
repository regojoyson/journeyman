// Interfaces
export type { ICodingCLI } from "./interfaces/coding-cli.interface.ts";
export type { IGitProvider } from "./interfaces/git-provider.interface.ts";
export type { IIssueProvider } from "./interfaces/issue.interface.ts";
export type { INotificationProvider } from "./interfaces/notification.interface.ts";

// Types
export type * from "./types/git.types.ts";
export type * from "./types/coding.types.ts";
export type * from "./types/coding-models.types.ts";
export * from "./types/coding-tools.types.ts";
export type * from "./types/custom-phases.types.ts";
export type * from "./types/skills.types.ts";
export type * from "./types/issue.types.ts";
export type * from "./types/notification.types.ts";
export type * from "./types/session.types.ts";
export type * from "./types/pipeline.types.ts";
export type * from "./types/human-task.types.ts";
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
  IOrchestratorEngine, SubmitWorkflowInstanceArgs,
} from "./interfaces/orchestrator-engine.interface.ts";
export type {
  IPauseableEngine, IRetryableEngine,
} from "./interfaces/orchestrator-capabilities.interface.ts";
export {
  isPauseableEngine, isRetryableEngine,
} from "./interfaces/orchestrator-capabilities.interface.ts";
export type {
  IWorkflowStore, IWorkflowVersionStore, IWorkflowGrantsStore,
  CreateWorkflowArgs, WorkflowListFilter, CreateWorkflowGrantArgs,
} from "./interfaces/workflow-store.interface.ts";
export type {
  IWorkflowInstanceStore, INodeExecutionStore, CreateWorkflowInstanceArgs,
} from "./interfaces/workflow-instance-store.interface.ts";
export type { IWorkflowInstanceGrantsStore } from "./interfaces/workflow-instance-grants-store.interface.ts";
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
export type { IWorkflowJsonConverter } from "./interfaces/flow-json-converter.interface.ts";
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
  Workflow, WorkflowGraph, WorkflowEdge, WorkflowEdgeType, WorkflowNode, WorkflowNodeType, WorkflowVersion,
  WorkflowSchemaVersion,
  RetryPolicy, WorkflowRetryPolicy, BackoffStrategy,
  McpServerConfig, McpTransport, WorkflowInputValue, WorkflowInputDef,
  WorkflowSaveWarning,
  SecretBinding,
  WorkflowDefaults,
} from "./types/flow.types.ts";
export { WORKFLOW_SCHEMA_VERSION } from "./types/flow.types.ts";
export type {
  JsonLogicExpr, JsonLogicVar, JsonLogicLiteral,
} from "./types/flow-condition.types.ts";
export {
  WORKFLOW_INPUT_SUGGESTIONS,
  isJsonLogicExpr,
} from "./types/flow-condition.types.ts";
export type {
  WorkflowScope, WorkflowGrantPrincipalType, WorkflowGrantRole, WorkflowGrant, WorkflowStatus,
} from "./types/flow.types.ts";
export {
  validateForPublish,
} from "./validation/validate-for-publish.ts";
export type {
  PublishError, PublishValidationResult, PublishValidationContext,
  PhaseConfigIssue, PhaseConfigValidator,
} from "./validation/validate-for-publish.ts";
export type {
  WorkflowInstanceGrant, WorkflowInstanceGrantPrincipalType, WorkflowInstanceGrantRole,
  CreateWorkflowInstanceGrantArgs, ActorContext, WorkflowInstanceListScope,
} from "./types/workflow-instance-grants.types.ts";
export type {
  WorkflowInstance, WorkflowInstanceEvent, WorkflowInstanceEventType, WorkflowInstanceStatus, TriggerSource,
  NodeExecution, NodeExecutionStatus,
} from "./types/workflow-instance.types.ts";
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
export * from "./types/mcp.types.ts";
export { buildIssueRef, parseIssueRef } from "./utils/issue-ref.ts";
export type { IssueRefProvider, ParsedIssueRef } from "./utils/issue-ref.ts";
export { formatIssueForPrompt, isIssueLike } from "./utils/format-issue.ts";
export {
  validateInputBinding,
  validateWorkflowInputs,
  shapeTag,
} from "./utils/validate-workflow.ts";
export { getStartWorkflowInputs } from "./utils/start-node.ts";
export type {
  BindingCheck,
  ValidationCatalog,
  ValidationCatalogEntry,
} from "./utils/validate-workflow.ts";
export type {
  WebhookEvent,
  WebhookEventStatus,
  WebhookProvider,
  CreateWebhookEventArgs,
} from "./types/webhook.types.ts";
export type { IWebhookEventStore } from "./interfaces/webhook-event-store.interface.ts";
