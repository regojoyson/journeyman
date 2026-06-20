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
export { parseRepoList } from "./parse-repo-list.ts";
export type * from "./types/custom-steps.types.ts";
export {
  CUSTOM_STEP_EXPORT_KIND,
  CUSTOM_STEP_EXPORT_VERSION,
} from "./types/custom-steps.types.ts";
export type * from "./types/builder.types.ts";
export type * from "./types/agent.types.ts";
export type * from "./types/connection.types.ts";
export * from "./types/custom-step-icons.ts";
export type * from "./types/skills.types.ts";
export type * from "./types/issue.types.ts";
export type * from "./types/notification.types.ts";
export type * from "./types/session.types.ts";
export type * from "./types/pipeline.types.ts";
export type * from "./types/human-task.types.ts";
export { HUMAN_TASK_RESERVED_KEYS } from "./types/human-task.types.ts";
export type * from "./types/webhook-wait.types.ts";
export { WEBHOOK_WAIT_RESERVED_KEYS } from "./types/webhook-wait.types.ts";
export type {
  JoinMode,
  ForkConfig,
  JoinConfig,
  JoinBranchResult,
  JoinNodeOutput,
} from "./types/parallel.types.ts";
export { DEFAULT_JOIN_MODE } from "./types/parallel.types.ts";
export type * from "./types/secret-slot.types.ts";
export * from "./types/identity.types.ts";
export type * from "./types/workspace.types.ts";
export { WORKSPACE_PERMISSIONS } from "./types/workspace.types.ts";
export { ROLE_GRANTS, roleGrants, resolvePermissions, evaluateCan } from "./workspace-permissions.ts";
// Logger
export {
  createLogger, type Logger,
  createWorkflowLogger, loggerForRun, type WorkflowLogCtx,
  serializeError, type SerializedError,
  redactString, redactObject,
  LogTail,
  appendStepEvent, type MinimalEventBus,
} from "./logger.ts";

export type {
  PipelineContext,
  IStep,
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
  IWorkflowStore, IWorkflowVersionStore,
  CreateWorkflowArgs, WorkflowListFilter,
} from "./interfaces/workflow-store.interface.ts";
export type {
  IWorkflowInstanceStore, INodeExecutionStore, CreateWorkflowInstanceArgs,
} from "./interfaces/workflow-instance-store.interface.ts";
export type {
  IWorkflowTriggerStore,
  WorkflowTriggerIndexRow,
  WorkflowTriggerKind,
  UpsertWorkflowTriggerArgs,
} from "./interfaces/workflow-trigger-store.interface.ts";
export type {
  IEventBus, AppendEventArgs,
} from "./interfaces/event-bus.interface.ts";
export type {
  IStepHandler, IStepRegistry, StepRunResult,
} from "./interfaces/step-registry.interface.ts";
export type {
  IWorkspace, IWorkspaceProvider,
} from "./interfaces/workspace-provider.interface.ts";
export type {
  SandboxType,
  ExecutionMode,
  Connectivity,
  ExecutionEnvironmentSpec,
  ProvisionedEnv,
  ExecOp,
  ExecResult,
  OperationRunner,
  IExecutionEnvironment,
  ResolvedSandbox,
  ExecutionEnvironmentBackend,
  IExecutionEnvironmentRegistry,
  FileBundle,
} from "./types/execution-environment.types.ts";
export type {
  SandboxScope,
  Sandbox,
  CreateSandboxArgs,
  UpdateSandboxArgs,
} from "./types/sandbox.types.ts";
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
  kindForStepType,
} from "./registries/provider-catalog.ts";
export type { ProviderEntry } from "./registries/provider-catalog.ts";
// Aliased to avoid colliding with flow-editor's own ExecutorKind (which includes "control").
export type { ExecutorKind as CoreExecutorKind } from "./registries/provider-catalog.ts";
export * from "./registries/builder-availability.ts";
export * from "./registries/notification-fields.ts";
export * from "./registries/opencode-slots.ts";
export { codingModelKeySlot } from "./registries/coding-model-key-slot.ts";
export { AISDK_PROVIDER_PACKAGES, isAiSdkPackage, type AiSdkPackage } from "./registries/aisdk-packages.ts";

// === Phase 1 data types ===
export type {
  Workflow, WorkflowGraph, WorkflowEdge, WorkflowEdgeType, WorkflowNode, WorkflowNodeType, WorkflowVersion,
  WorkflowVersionSummary,
  WorkflowSchemaVersion,
  RetryPolicy, WorkflowRetryPolicy, BackoffStrategy,
  McpServerConfig, McpTransport, WorkflowInputValue, WorkflowInputDef, WorkflowAttributeDef,
  WorkflowSaveWarning,
  SecretBinding,
  WorkflowDefaults,
} from "./types/flow.types.ts";
export { WORKFLOW_SCHEMA_VERSION, TRIGGER_NODE_TYPES, isTriggerNode, findTriggerNodes, findManualTriggerNode, workflowInputDefShape, workflowAttributeDefShape } from "./types/flow.types.ts";
export type { WorkflowTriggerNodeType } from "./types/flow.types.ts";
export * from "./types/workflow-draft.ts";
export type {
  TriggerInputMapping,
  TriggerInputMappingType,
  TriggerManualConfig,
  TriggerWebhookConfig,
  TriggerHumanConfig,
  TriggerHumanFieldOverride,
  TriggerHumanFieldWidget,
} from "./types/workflow-trigger.types.ts";
export type {
  JsonLogicExpr, JsonLogicVar, JsonLogicLiteral,
} from "./types/flow-condition.types.ts";
export {
  WORKFLOW_INPUT_SUGGESTIONS,
  isJsonLogicExpr,
} from "./types/flow-condition.types.ts";
export type {
  WorkflowStatus,
} from "./types/flow.types.ts";
export {
  validateForPublish,
  formatPublishError,
} from "./validation/validate-for-publish.ts";
export { validateForkJoinPairs } from "./validation/validate-fork-join-pairs.ts";
export type { ForkJoinPairError } from "./validation/validate-fork-join-pairs.ts";
export type {
  PublishError, PublishValidationResult, PublishValidationContext,
  StepConfigIssue, StepConfigValidator,
} from "./validation/validate-for-publish.ts";
export type {
  WorkflowInstance, WorkflowInstanceEvent, WorkflowInstanceEventType, WorkflowInstanceStatus, TriggerSource,
  NodeExecution, NodeExecutionStatus,
} from "./types/workflow-instance.types.ts";
export { isTerminalStatus, TERMINAL_STATUSES } from "./types/workflow-instance.types.ts";
export type {
  StepContext, StepFailure, StepInput, StepOutput,
  OutputSchema,
} from "./types/step-handler.types.ts";
export type { Shape, InputField, InputFields } from "./types/shape.types.ts";
export {
  IssueShape, RepoShape, PullRequestShape, WorkspaceShape,
  NAMED_SHAPES, resolveShape, shapesEqual, shapeAtPath, shapesCompatible,
} from "./types/shapes.ts";
export { parsePathSegments, shapeAtPathSegs } from "./types/path-segments.ts";
export type { PathSeg } from "./types/path-segments.ts";
export * from "./types/secrets.types.ts";
export * from "./types/mcp.types.ts";
export { extractTemplateRefs, replaceTemplateRefs } from "./utils/template-refs.ts";
export type { TemplateSegment } from "./utils/template-refs.ts";
export { formatIssueForPrompt, isIssueLike } from "./utils/format-issue.ts";
export { formatDuration } from "./utils/format-duration.ts";
export {
  validateInputBinding,
  validateWorkflowInputs,
  literalMatchesShape,
  shapeTag,
} from "./utils/validate-workflow.ts";
export { getStartWorkflowInputs } from "./utils/start-node.ts";
export { pauseNodeOutputSchema } from "./utils/pause-node-output.ts";
export { joinNodeOutputSchema } from "./utils/join-node-output.ts";
export { validatePauseNodeOutputNames } from "./utils/pause-node-output-names.ts";
export type { PauseOutputNameProblem, PauseOutputNameReason } from "./utils/pause-node-output-names.ts";
export {
  buildOutgoingEdgeMap,
  walkReachable,
  findConvergence,
} from "./utils/find-convergence.ts";
export type { OutgoingEdgeMap } from "./utils/find-convergence.ts";
export type {
  BindingCheck,
  ValidationCatalog,
  ValidationCatalogEntry,
  CustomStepValidationEntry,
} from "./utils/validate-workflow.ts";
export type {
  WebhookEvent,
  WebhookEventStatus,
  WebhookProvider,
  CreateWebhookEventArgs,
  Webhook,
  WebhookAuthConfig,
  WebhookKind,
  PresetId,
} from "./types/webhook.types.ts";
export type { IWebhookEventStore } from "./interfaces/webhook-event-store.interface.ts";
export type {
  IWebhookStore,
  CreateWebhookArgs,
  UpdateWebhookArgs,
} from "./interfaces/webhook-store.interface.ts";
