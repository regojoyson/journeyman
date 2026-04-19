import type { ICodingCLI } from "../../interface.ts";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  IProviderMeta,
} from "@journeyman/core";
import type { AnalyzeOptions, AnalyzeResult, PlanOptions, PlanResult, ImplementOptions, ImplementResult } from "@journeyman/core";
import { scanRepos } from "./operations/scan-repos.ts";
import { checkoutRepo } from "./operations/checkout-repo.ts";
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
  scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
    return scanRepos(opts);
  }

  checkoutRepo(opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> {
    return checkoutRepo(opts);
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
