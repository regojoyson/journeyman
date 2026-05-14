import type { ICodingCLI } from "../../interface.ts";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  IProviderMeta,
  CodingCLIPhase,
  CodingCLIProviderConfig,
} from "@journeyman/core";
import type {
  RunCustomPromptOptions, RunCustomPromptResult,
} from "@journeyman/core";
import { scanRepos } from "./operations/scan-repos.ts";
import { checkoutRepo } from "./operations/checkout-repo.ts";
import { cleanupRepos } from "./operations/cleanup-repos.ts";
import { createWorkspace } from "./operations/create-workspace.ts";
import { runCustomPrompt } from "./operations/run-custom-prompt.ts";

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

  cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult> {
    return cleanupRepos({ ...opts, model: this.resolveModel("cleanupRepos") });
  }

  createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> {
    return createWorkspace({ ...opts, model: this.resolveModel("createWorkspace") });
  }

  runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
    return runCustomPrompt({ ...opts, model: opts.model ?? this.resolveModel("runCustomPrompt") });
  }
}
