export type StepInput = Record<string, unknown>;
export type StepOutput = Record<string, unknown>;

/**
 * Returned by an IStepHandler when execution fails. The orchestrator decides
 * whether to retry based on `retryable` and the node's retry policy.
 */
export interface StepFailure {
  errorClass: string;
  message: string;
  /** True ⇒ orchestrator may retry. False ⇒ short-circuit, route to error edge. */
  retryable: boolean;
  details?: Record<string, unknown>;
}

/**
 * Minimal context handed to IStepHandler.run(). Intentionally narrow — step
 * handlers must not depend on the legacy PipelineContext.
 */
export interface StepContext {
  workflowInstanceId: string;
  nodeId: string;
  attempt: number;
  workspaceDir: string;
  signal: AbortSignal;
  /** Resolved env vars for this step, keyed by slot name (from resolveBindings). */
  env: Record<string, string>;
  /** Frozen copy of workflow.input — values declared on the start node's workflowInputs. */
  workflowInputs: Record<string, unknown>;
  /** Append a step.log event for live UI streaming. */
  log(line: string, meta?: Record<string, unknown>): void;
}

export type { OutputSchema } from "./shape.types.ts";
