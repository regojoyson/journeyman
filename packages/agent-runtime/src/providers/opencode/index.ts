// packages/agent-runtime/src/providers/opencode/index.ts
import type { ICodingCLI, IProviderMeta, CodingCLIProviderConfig } from "@journeyman/core";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  RunCustomPromptOptions, RunCustomPromptResult,
  ResolvedMcpInstance, CodingModelConfig, ResolvedSkillPackage,
} from "@journeyman/core";
import { startServer } from "./client.ts";
import type { OpenCodeProviderConfig } from "./types.ts";
import { buildServerConfig } from "./server-config.ts";
import { scanRepos } from "./operations/scan-repos.ts";
import { checkoutRepo } from "./operations/checkout-repo.ts";
import { runCustomPrompt } from "./operations/run-custom-prompt.ts";

export type { OpenCodeProviderConfig } from "./types.ts";

export class OpenCodeProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "opencode",
    name: "OpenCode CLI",
    description: "AI coding via OpenCode SDK (model-agnostic: Anthropic, OpenAI, Gemini…)",
    category: "coding-cli",
  };

  readonly #config: OpenCodeProviderConfig;

  constructor(config: OpenCodeProviderConfig, private _providerConfig: CodingCLIProviderConfig = {}) {
    if (!config.mode) throw new Error("OpenCodeProvider: config.mode is required ('managed' | 'external')");
    this.#config = config;
  }

  /** Start a managed server with op-specific config, run `fn`, always close. */
  async #withServer<T>(
    runtime: {
      mcps?: ResolvedMcpInstance[];
      model?: string;
      modelConfig?: CodingModelConfig;
      env?: Record<string, string>;
      maxSteps?: number;
      skills?: ResolvedSkillPackage[];
      signal?: AbortSignal;
    },
    fn: (client: Awaited<ReturnType<typeof startServer>>["client"]) => Promise<T>,
  ): Promise<T> {
    const serverConfig = buildServerConfig(this.#config, runtime);
    const handle = await startServer(this.#config, serverConfig, runtime.env, runtime.signal);
    try {
      return await fn(handle.client);
    } finally {
      handle.close();
    }
  }

  async scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
    return this.#withServer(
      { model: opts.model, modelConfig: opts.modelConfig },
      (client) => scanRepos(client, this.#config, opts),
    );
  }

  async checkoutRepo(opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> {
    return this.#withServer(
      { model: opts.model, modelConfig: opts.modelConfig },
      (client) => checkoutRepo(client, this.#config, opts),
    );
  }

  async runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
    return this.#withServer(
      { mcps: opts.mcps, model: opts.model, modelConfig: opts.modelConfig, env: opts.env, maxSteps: opts.maxSteps, skills: opts.skills, signal: opts.signal },
      (client) => runCustomPrompt(client, this.#config, opts),
    );
  }
}
