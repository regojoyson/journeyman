import type { ICodingCLI } from "../../interface.ts";
import type {
  CloneReposOptions, CloneReposResult,
  ScanReposOptions, ScanReposResult,
  ResetReposOptions, ResetReposResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  IProviderMeta,
} from "@journeyman/core";
import type { AnalyzeOptions, AnalyzeResult, PlanOptions, PlanResult, ImplementOptions, ImplementResult } from "@journeyman/core";
import { cloneRepos } from "./operations/clone-repos.ts";
import { scanRepos } from "./operations/scan-repos.ts";
import { resetRepos } from "./operations/reset-repos.ts";
import { commitPushRepos } from "./operations/commit-push-repos.ts";
import { cleanupRepos } from "./operations/cleanup-repos.ts";
import { createWorkspace } from "./operations/create-workspace.ts";
import { analyze } from "./operations/analyze.ts";
import { plan } from "./operations/plan.ts";
import { implement } from "./operations/implement.ts";

/**
 * Claude coding CLI provider.
 * Implements ICodingCLI using the Claude Agent SDK internally.
 */
export class ClaudeProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "claude",
    name: "Claude Code CLI",
    description: "AI coding via @anthropic-ai/claude-agent-sdk",
    category: "coding-cli",
  };

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

  createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> {
    return createWorkspace(opts);
  }

  // AI operations
  analyze(opts: AnalyzeOptions): Promise<AnalyzeResult> {
    return analyze(opts);
  }

  plan(opts: PlanOptions): Promise<PlanResult> {
    return plan(opts);
  }

  implement(opts: ImplementOptions): Promise<ImplementResult> {
    return implement(opts);
  }
}
