export type PhaseInput = Record<string, unknown>;
export type PhaseOutput = Record<string, unknown>;

/**
 * Returned by an IPhaseHandler when execution fails. The orchestrator decides
 * whether to retry based on `retryable` and the node's retry policy.
 */
export interface PhaseFailure {
  errorClass: string;
  message: string;
  /** True ⇒ orchestrator may retry. False ⇒ short-circuit, route to error edge. */
  retryable: boolean;
  details?: Record<string, unknown>;
}

/**
 * Minimal context handed to IPhaseHandler.run(). Intentionally narrow — phase
 * handlers must not depend on the legacy PipelineContext.
 */
export interface PhaseContext {
  runId: string;
  nodeId: string;
  attempt: number;
  workspaceDir: string;
  signal: AbortSignal;
  /** Resolved env vars for this phase (from ICredentialStore). */
  env: Record<string, string>;
  /** Append a phase.log event for live UI streaming. */
  log(line: string, meta?: Record<string, unknown>): void;
}
