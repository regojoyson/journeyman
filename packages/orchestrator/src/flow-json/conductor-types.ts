// Discriminated union of all Conductor task shapes the converter can emit.

export interface SimpleTask {
  type: "SIMPLE";
  name: string;
  taskReferenceName: string;
  inputParameters: Record<string, unknown>;
  retryCount?: number;
  retryLogic?: "FIXED" | "LINEAR_BACKOFF" | "EXPONENTIAL_BACKOFF";
  retryDelaySeconds?: number;
  backoffScaleFactor?: number;
  timeoutSeconds?: number;
  responseTimeoutSeconds?: number;
}

export interface SwitchTask {
  type: "SWITCH";
  name: string;
  taskReferenceName: string;
  evaluatorType: "javascript" | "value-param";
  expression: string;
  inputParameters: Record<string, unknown>;
  decisionCases: Record<string, ConductorTaskDef[]>;
  defaultCase?: ConductorTaskDef[];
}

export interface ForkJoinTask {
  type: "FORK_JOIN";
  name: string;
  taskReferenceName: string;
  forkTasks: ConductorTaskDef[][];
}

export interface JoinTask {
  type: "JOIN";
  name: string;
  taskReferenceName: string;
  joinOn: string[];
}

export interface DoWhileTask {
  type: "DO_WHILE";
  name: string;
  taskReferenceName: string;
  loopCondition: string;
  loopOver: ConductorTaskDef[];
  inputParameters: Record<string, unknown>;
}

export interface WaitTask {
  type: "WAIT";
  name: string;
  taskReferenceName: string;
  inputParameters: { duration?: string; until?: string };
}

export interface HumanTask {
  type: "HUMAN";
  name: string;
  taskReferenceName: string;
  inputParameters: {
    outputs: Array<{
      name: string;
      type: "string" | "number" | "boolean" | "json" | "date";
      label?: string;
      description?: string;
      required?: boolean;
      default?: unknown;
      fromPath?: string;
    }>;
    prompt?: string;
    listensFor?: string[];
    acceptIf?: unknown;             // JSONLogic expression — opaque at the engine layer
    timeoutDurationMs?: number;
    timeoutDefaults?: Record<string, unknown>;
    /** Discriminator: "human-task" or "webhook-wait". */
    kind?: "human-task" | "webhook-wait";
    /** Webhook-wait: provider whose events resolve this node. */
    provider?: string;
    /** Webhook-wait: how the paused node binds to an incoming event. */
    correlationKey?: "issueRef";
    /** Human-task: notification config dispatched on pause. */
    notify?: { channel: "slack" | "console"; target: string; message?: string };
  };
}

export interface SubWorkflowTask {
  type: "SUB_WORKFLOW";
  name: string;
  taskReferenceName: string;
  subWorkflowParam: { name: string; version?: number };
  inputParameters: Record<string, unknown>;
}

export interface TerminateTask {
  type: "TERMINATE";
  name: string;
  taskReferenceName: string;
  inputParameters: { terminationStatus: "COMPLETED" | "FAILED"; workflowOutput?: Record<string, unknown> };
}

export type ConductorTaskDef =
  | SimpleTask
  | SwitchTask
  | ForkJoinTask
  | JoinTask
  | DoWhileTask
  | WaitTask
  | HumanTask
  | SubWorkflowTask
  | TerminateTask;

export interface ConductorWorkflowDef {
  name: string;
  version: number;
  schemaVersion: 2;
  tasks: ConductorTaskDef[];
  /** Phase 4: max times any single node may execute. Enforced by the worker harness. */
  cycleVisitLimit?: number;
  /** Phase 5: data shape for whole-workflow retry. Runtime interpretation lands in Phase 7. */
  flowRetry?: { maxAttempts?: number; backoffSeconds?: number };
}
