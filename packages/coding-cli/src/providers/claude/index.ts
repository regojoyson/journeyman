import type { ICodingCLI } from "../../interface.ts";
import type {
  CloneReposOptions, CloneReposResult,
  ScanReposOptions, ScanReposResult,
  ResetReposOptions, ResetReposResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
} from "@journeyman/core";
import type { AnalyzeOptions, AnalyzeResult, PlanOptions, PlanResult, ImplementOptions, ImplementResult } from "@journeyman/core";
import { cloneRepos } from "./operations/clone-repos.ts";
import { scanRepos } from "./operations/scan-repos.ts";
import { resetRepos } from "./operations/reset-repos.ts";
import { commitPushRepos } from "./operations/commit-push-repos.ts";
import { cleanupRepos } from "./operations/cleanup-repos.ts";
import { analyze } from "./operations/analyze.ts";
import { plan } from "./operations/plan.ts";

/**
 * Claude coding CLI provider.
 * Implements ICodingCLI using the Claude Agent SDK internally.
 */
export class ClaudeProvider implements ICodingCLI {
  // Git CLI operations (powered by Claude bash tool)
  cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult> {
    return cloneRepos(opts);
  }

  scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
    return scanRepos(opts);
  }

  resetRepos(opts: ResetReposOptions): Promise<ResetReposResult> {
    return resetRepos(opts);
  }

  commitPushRepos(opts: CommitPushReposOptions): Promise<CommitPushReposResult> {
    return commitPushRepos(opts);
  }

  cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult> {
    return cleanupRepos(opts);
  }

  // AI operations
  analyze(opts: AnalyzeOptions): Promise<AnalyzeResult> {
    return analyze(opts);
  }

  plan(opts: PlanOptions): Promise<PlanResult> {
    return plan(opts);
  }

  implement(_opts: ImplementOptions): Promise<ImplementResult> {
    throw new Error("ClaudeProvider.implement not yet implemented");
  }
}
