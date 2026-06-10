import type { ICodingCLI } from "../../interface.ts";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  RunCustomPromptOptions, RunCustomPromptResult,
  IProviderMeta, CodingCLIStep, CodingCLIProviderConfig,
} from "@journeyman/core";
import { scanRepos } from "./operations/scan-repos.ts";
import { checkoutRepo } from "./operations/checkout-repo.ts";
import { runCustomPrompt } from "./operations/run-custom-prompt.ts";

export class AiSdkProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "aisdk",
    name: "AI SDK (multi-model)",
    description: "Multi-vendor AI coding via Vercel AI SDK 6",
    category: "coding-cli",
  };

  constructor(private config: CodingCLIProviderConfig = {}) {}

  private resolveModelId(step: CodingCLIStep): string | undefined {
    return this.config.models?.[step] ?? this.config.defaultModel;
  }

  scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
    return scanRepos({ ...opts, model: opts.model ?? this.resolveModelId("scanRepos") });
  }
  checkoutRepo(opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> {
    return checkoutRepo({ ...opts, model: opts.model ?? this.resolveModelId("checkoutRepo") });
  }
  runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
    return runCustomPrompt({ ...opts, model: opts.model ?? this.resolveModelId("runCustomPrompt") });
  }
}
