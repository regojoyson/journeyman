import type { ResolvedMcpInstance } from "./mcp.types.ts";
import type { ResolvedSkillPackage } from "./skills.types.ts";
import type { CanonicalTool } from "./coding-tools.types.ts";
import type { CodingModelConfig } from "./coding-models.types.ts";

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
  /** Provider-specific endpoint config for the chosen model (OpenCode custom endpoints). */
  modelConfig?: CodingModelConfig;
  /** Optional per-message log callback. Receives a one-line summary plus the raw SDK message in `meta.sdkMessage`. */
  onLog?: CodingCliLogFn;
  /** Verbosity for SDK log lines emitted via `onLog`. Defaults to "all" when `onLog` is provided. */
  agentLogLevel?: AgentLogLevel;
  /**
   * Max agent steps/turns (tool calls + generations) before the loop is stopped.
   * A small step (make a branch) needs ~10–30; an implementation step on a large
   * repo can need a few hundred. Providers apply their own default when omitted.
   */
  maxSteps?: number;
  /**
   * Prompt caching toggle. Defaults to true when omitted. When false, providers
   * omit explicit cache markers (Claude's SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
   * aisdk-Anthropic cacheControl). The stable-prefix/dynamic-suffix prompt
   * structure is applied regardless — auto-caching vendors (MiniMax/OpenAI/Gemini)
   * cannot be switched off client-side.
   */
  caching?: boolean;
}

/** Normalized per-(call×model) token usage. Every provider maps its native shape to this. */
export interface TokenUsage {
  /** Execution engine: "claude" | "aisdk" | "opencode" | … */
  provider: string;
  /** Underlying API vendor: "anthropic" | "openai" | "google" | … when known. */
  vendor?: string;
  /** Exact model id reported by the provider. */
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  /** Full provider usage blob for forensics / future fields. */
  raw?: unknown;
}

export interface RunCustomPromptResult {
  result?: string;
  structured?: unknown;
  error?: string;
  sessionId?: string;
  /** One entry per model used in the call. Empty/undefined ⇒ provider reported nothing. */
  usage?: TokenUsage[];
}
