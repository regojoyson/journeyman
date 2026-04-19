import type {
  ScanReposOptions, ScanReposResult,
  ResetReposOptions, ResetReposResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
} from "../types/git.types.ts";
import type { AnalyzeOptions, AnalyzeResult, PlanOptions, PlanResult, ImplementOptions, ImplementResult } from "../types/coding.types.ts";

/**
 * Contract for AI coding CLI providers (Claude, Gemini, Codex).
 * Covers git operations run via CLI and AI-powered analyze/plan/implement.
 */
export interface ICodingCLI {
  // Git operations (executed via CLI bash)
  scanRepos(opts: ScanReposOptions): Promise<ScanReposResult>;
  resetRepos(opts: ResetReposOptions): Promise<ResetReposResult>;
  commitPushRepos(opts: CommitPushReposOptions): Promise<CommitPushReposResult>;
  cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult>;
  createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult>;

  // AI operations
  analyze(opts: AnalyzeOptions): Promise<AnalyzeResult>;
  plan(opts: PlanOptions): Promise<PlanResult>;
  implement(opts: ImplementOptions): Promise<ImplementResult>;
}
