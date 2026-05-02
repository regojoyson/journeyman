export type IProviderMeta = {
  id: string;
  name: string;
  description: string;
  category: "coding-cli" | "git" | "ticket" | "notification";
};

export type PhaseResult =
  | { status: "ok"; artifacts: Record<string, unknown> }
  | {
      status: "blocked";
      reason: string;
      waitFor?: "ticket-comment" | "pr-comment" | "manual";
      artifacts?: Record<string, unknown>;   // NEW — merged into run before blocking
    }
  | { status: "failed"; error: { message: string; code?: string; stack?: string } };

export type StepRecord = {
  id: string;                          // unique within flow
  phase: string;                       // registry key
  attempt: number;
  status: "pending" | "running" | "ok" | "blocked" | "failed" | "cancelled";
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: { message: string; code?: string; stack?: string };
  blockedReason?: string;
  waitFor?: "ticket-comment" | "pr-comment" | "manual";
  /** Per-field source: "node" = explicit on the phase node; "flow-default" = inherited from FlowGraph.defaults. */
  inputSources?: Record<string, "node" | "flow-default">;
};

export type ArtifactHandle = {
  kind: "artifact";
  sessionId: string;
  key: string;
  size: number;
  contentType?: string;
  uri: string;                          // "file://..." | "s3://..."
  sha256?: string;
};

export type ProductRepo = {
  providerId: "github" | "gitlab";
  owner: string;
  repo: string;
  url: string;
  defaultBranch: string;
};

export type TicketWorkflow = {
  trigger?: {
    matchLabels?: string[];
    matchStatus?: string[];
  };
  statuses: Record<string, string>;     // semantic name → literal value
};

export type ProductConfig = {
  flow: string;
  workspace: string;
  repos: ProductRepo[];
  providerConfig?: {
    ticket?: Record<string, unknown>;
    git?: Record<string, unknown>;
    coding?: Record<string, unknown>;
    notification?: Record<string, unknown>;
  };
  ticketWorkflow?: TicketWorkflow;
  webhookSecrets?: Record<string, string>;
  concurrency?: number;
};

export type FlowStepDefinition = {
  id: string;                           // unique within flow
  phase: string;
  config?: Record<string, unknown>;
  retry?: { attempts: number; backoffMs: number };
  timeoutMs?: number;
  onFailure?: "fail" | "skip" | "retry" | "block";  // default "fail"
  requiredSecrets?: string[];           // env-var names; resolved before step exec
};

export type FlowDefinition = {
  name: string;
  providers: { ticket: string; git: string; coding: string; notification: string };
  steps: FlowStepDefinition[];
};

export type PipelineRun = {
  sessionId: string;
  productId: string;
  issueRef: string;                     // canonical id e.g. "jira:PROJ-123"
  issueRefShort: string;                // short id for display e.g. "PROJ-123"
  flowName: string;
  flowSnapshot: FlowDefinition;         // frozen copy
  status: "queued" | "running" | "blocked" | "completed" | "failed" | "cancelling" | "cancelled";
  currentStep: string | null;           // step id
  steps: StepRecord[];
  artifacts: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PipelineConfig = {
  defaultFlow: string;
  /** Where pipeline run state, traces, and artifacts are persisted.
   *  Currently only the `file` storage type is supported. Future types
   *  (e.g. `postgres`, `redis`) will be added as sibling keys. */
  stateStorage?: {
    type: "file";
    /** Directory root for file-based storage. Resolves relative to server CWD.
     *  Defaults to "./workspaces". */
    directory?: string;
  };
  products: Record<string, ProductConfig>;
  server: {
    port: number;
    bearerTokenEnv: string;
    webhooks: {
      github?: { secretEnv: string; path?: string };
      gitlab?: { secretEnv: string; path?: string };
      jira?:   { secretEnv: string; path?: string };
    };
  };
  workspaces?: {
    cleanupOn?: Array<PipelineRun["status"]>;
    retentionDays?: number;
    keepFailed?: boolean;
  };
};

export type PipelineTrigger = {
  sourceId: string;
  productId: string;
  issueRef: string;
  issueRefShort: string;
  flowName?: string;
  rawPayload: unknown;
  receivedAt: string;
  eventType?: "new-ticket" | "status-change" | "comment";   // NEW
  newStatus?: string;                                         // NEW — literal status value
};

export type PipelineEvent =
  | { type: "runStarted";  sessionId: string; issueRef: string; flowName: string; at: string }
  | { type: "stepStarted"; sessionId: string; stepId: string; phase: string; attempt: number; at: string }
  | { type: "stepEnded";   sessionId: string; stepId: string; phase: string; attempt: number; status: StepRecord["status"]; durationMs: number; at: string }
  | { type: "logLine";     sessionId: string; stepId: string; level: "info"|"warn"|"error"; line: string; at: string }
  | { type: "statusChanged"; sessionId: string; from: PipelineRun["status"]; to: PipelineRun["status"]; at: string }
  | { type: "runEnded";    sessionId: string; status: PipelineRun["status"]; at: string };

export type TraceLine = {
  ts: string;
  level: "info" | "warn" | "error";
  stepId: string;
  message: string;
  meta?: Record<string, unknown>;
};
