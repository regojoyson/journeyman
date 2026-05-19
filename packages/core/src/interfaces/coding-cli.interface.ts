import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
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
  cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult>;
  createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult>;

  // Custom user-defined AI phase
  runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult>;
}
