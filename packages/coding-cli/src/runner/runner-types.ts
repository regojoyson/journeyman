/** Request piped to the runner (stdin) or passed to an in-process dispatch. */
export interface RunnerRequest {
  /** Operation id: "custom-prompt" | "scan-repos" | "checkout-repo". */
  op: string;
  /** Coding provider key; runner builds the matching provider. Defaults to "claude". */
  provider?: string;
  /** Operation options (the ICodingCLI method's options, minus functions). */
  opts?: Record<string, unknown>;
}

/** Response written by the runner (stdout) / returned by dispatch. */
export interface RunnerResponse {
  ok: boolean;
  /** Structured payload for the operation (e.g. the method's result object). */
  structured?: unknown;
  /** Text payload for text-mode custom prompts. */
  result?: string;
  error?: string;
}
