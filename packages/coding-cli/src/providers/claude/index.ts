import type { ICodingCLI } from "../../interface.ts";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  IProviderMeta,
  CodingCLIPhase,
  CodingCLIProviderConfig,
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

export class ClaudeProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "claude",
    name: "Claude Code CLI",
    description: "AI coding via @anthropic-ai/claude-agent-sdk",
    category: "coding-cli",
  };

  constructor(private config: CodingCLIProviderConfig = {}) {}

  private resolveModel(phase: CodingCLIPhase): string | undefined {
    return this.config.models?.[phase] ?? this.config.defaultModel;
  }

  scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
    return scanRepos({ ...opts, model: this.resolveModel("scanRepos") });
  }

  checkoutRepo(opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> {
    return checkoutRepo({ ...opts, model: this.resolveModel("checkoutRepo") });
  }

  commitPushRepos(opts: CommitPushReposOptions): Promise<CommitPushReposResult> {
    return commitPushRepos({ ...opts, model: this.resolveModel("commitPushRepos") });
  }

  cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult> {
    return cleanupRepos({ ...opts, model: this.resolveModel("cleanupRepos") });
  }

  createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> {
    return createWorkspace({ ...opts, model: this.resolveModel("createWorkspace") });
  }

  analyze(opts: AnalyzeOptions): Promise<AnalyzeResult> {
    return analyze({ ...opts, model: this.resolveModel("analyze") });
  }

  plan(opts: PlanOptions): Promise<PlanResult> {
    return plan({ ...opts, model: this.resolveModel("plan") });
  }

  implement(opts: ImplementOptions): Promise<ImplementResult> {
    return implement({ ...opts, model: this.resolveModel("implement") });
  }
}
