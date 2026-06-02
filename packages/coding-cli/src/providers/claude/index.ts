import type { ICodingCLI } from "../../interface.ts";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  IProviderMeta,
  CodingCLIStep,
  CodingCLIProviderConfig,
} from "@journeyman/core";
import type {
  RunCustomPromptOptions, RunCustomPromptResult,
} from "@journeyman/core";
import { scanRepos } from "./operations/scan-repos.ts";
import { checkoutRepo } from "./operations/checkout-repo.ts";
import { runCustomPrompt } from "./operations/run-custom-prompt.ts";

export class ClaudeProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "claude",
    name: "Claude Code CLI",
    description: "AI coding via @anthropic-ai/claude-agent-sdk",
    category: "coding-cli",
  };

  constructor(private config: CodingCLIProviderConfig = {}) {}

  private resolveModel(step: CodingCLIStep): string | undefined {
    return this.config.models?.[step] ?? this.config.defaultModel;
  }

  scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
    return scanRepos({ ...opts, model: this.resolveModel("scanRepos") });
  }

  checkoutRepo(opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> {
    return checkoutRepo({ ...opts, model: this.resolveModel("checkoutRepo") });
  }

  runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
    return runCustomPrompt({ ...opts, model: opts.model ?? this.resolveModel("runCustomPrompt") });
  }
}
