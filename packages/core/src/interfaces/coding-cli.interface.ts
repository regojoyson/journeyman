import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
} from "../types/git.types.ts";
import type {
  RunCustomPromptOptions, RunCustomPromptResult,
} from "../types/coding.types.ts";

/**
 * Contract for AI coding CLI providers (Claude, Gemini, Codex).
 * Covers git operations run via CLI and AI-powered custom prompts.
 */
export interface ICodingCLI {
  // Git operations (executed via CLI bash)
  scanRepos(opts: ScanReposOptions): Promise<ScanReposResult>;
  checkoutRepo(opts: CheckoutRepoOptions): Promise<CheckoutRepoResult>;

  // Custom user-defined AI step
  runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult>;
}
