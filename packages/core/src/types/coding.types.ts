import type { ResolvedMcpInstance } from "./mcp.types.ts";
import type { ResolvedSkillPackage } from "./skills.types.ts";
import type { CanonicalTool } from "./coding-tools.types.ts";

/**
 * Optional callback invoked for each AI provider SDK message during a coding-CLI
 * operation. The step handler typically wires this to `ctx.log` so SDK events
 * are surfaced to the run-viewer UI as `step.log` events.
 */
export type CodingCliLogFn = (line: string, meta?: Record<string, unknown>) => void;

/**
 * Verbosity of agent SDK logs streamed to the run-viewer / persisted as `step.log` events.
 *  - "none":   no agent SDK lines (handler's own start/end lines still fire). Default.
 *  - "light":  only the final result line.
 *  - "medium": result + tool calls (no assistant text, no tool result content).
 *  - "all":    full transcript — assistant text, tool calls, tool results, result.
 */
export type AgentLogLevel = "none" | "light" | "medium" | "all";

// ---------------------------------------------------------------------------
// Provider config — shared across all coding-CLI providers
// ---------------------------------------------------------------------------

export type CodingCLIStep =
  | "scanRepos"
  | "checkoutRepo"
  | "runCustomPrompt";

export interface CodingCLIProviderConfig {
  /** Fallback model for any step not listed in `models`. */
  defaultModel?: string;
  /** Per-step model overrides. Takes precedence over defaultModel. */
  models?: Partial<Record<CodingCLIStep, string>>;
  /** Optional API key. When unset, the SDK uses its ambient credentials (env). */
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// Custom AI step — generic prompt runner
// ---------------------------------------------------------------------------

export interface RunCustomPromptOptions {
  prompt: string;
  outputMode: "none" | "text" | "structured";
  outputSchema?: Record<string, unknown>;
  cwd?: string;
  mcps?: ResolvedMcpInstance[];
  skills?: ResolvedSkillPackage[];
  /**
   * Canonical Journeyman tool names. Each provider translates to its native
   * tool names. Empty/undefined means a pure-prompt step (no tools).
   */
  tools?: CanonicalTool[];
  /**
   * Slot-keyed env values to inject into shell-tool child processes.
   * Resolved from FlowNode.secretBindings against the step's declared slots.
   * Provider passes this to its Bash-equivalent tool only; never substituted
   * into the prompt text.
   */
  env?: Record<string, string>;
  sessionId?: string;
  signal?: AbortSignal;
  model?: string;
  /** Optional per-message log callback. Receives a one-line summary plus the raw SDK message in `meta.sdkMessage`. */
  onLog?: CodingCliLogFn;
  /** Verbosity for SDK log lines emitted via `onLog`. Defaults to "all" when `onLog` is provided. */
  agentLogLevel?: AgentLogLevel;
}

export interface RunCustomPromptResult {
  result?: string;
  structured?: unknown;
  error?: string;
  sessionId?: string;
}
