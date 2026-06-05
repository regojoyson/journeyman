// packages/agent-runtime/src/providers/opencode/index.ts
import type { ICodingCLI, IProviderMeta, CodingCLIProviderConfig } from "@journeyman/core";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  RunCustomPromptOptions, RunCustomPromptResult,
} from "@journeyman/core";
import { getClient } from "./client.ts";
import type { OpenCodeClient } from "./client.ts";
import type { OpenCodeProviderConfig } from "./types.ts";
import { scanRepos } from "./operations/scan-repos.ts";
import { checkoutRepo } from "./operations/checkout-repo.ts";

export type { OpenCodeProviderConfig } from "./types.ts";

export class OpenCodeProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "opencode",
    name: "OpenCode CLI",
    description: "AI coding via OpenCode SDK (model-agnostic: Anthropic, OpenAI, Gemini…)",
    category: "coding-cli",
  };

  readonly #config: OpenCodeProviderConfig;
  #client: OpenCodeClient | null = null;

  constructor(config: OpenCodeProviderConfig, private _providerConfig: CodingCLIProviderConfig = {}) {
    if (!config.mode) throw new Error("OpenCodeProvider: config.mode is required ('managed' | 'external')");
    if (!config.model?.providerID) throw new Error("OpenCodeProvider: config.model.providerID is required");
    if (!config.model?.modelID) throw new Error("OpenCodeProvider: config.model.modelID is required");
    this.#config = config;
  }

  private async client(): Promise<OpenCodeClient> {
    if (!this.#client) this.#client = await getClient(this.#config);
    return this.#client;
  }

  async scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
    return scanRepos(await this.client(), this.#config, opts);
  }
  async checkoutRepo(opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> {
    return checkoutRepo(await this.client(), this.#config, opts);
  }
  async runCustomPrompt(_opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
    throw new Error("OpenCodeProvider.runCustomPrompt not implemented");
  }
}
