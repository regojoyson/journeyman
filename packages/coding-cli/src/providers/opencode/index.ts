// packages/coding-cli/src/providers/opencode/index.ts
import type { ICodingCLI, IProviderMeta } from "@journeyman/core";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  AnalyzeOptions, AnalyzeResult,
  PlanOptions, PlanResult,
  ImplementOptions, ImplementResult,
} from "@journeyman/core";
import { getClient } from "./client.ts";
import type { OpenCodeClient } from "./client.ts";
import type { OpenCodeProviderConfig } from "./types.ts";
import { scanRepos } from "./operations/scan-repos.ts";
import { checkoutRepo } from "./operations/checkout-repo.ts";
import { commitPushRepos } from "./operations/commit-push-repos.ts";
import { cleanupRepos } from "./operations/cleanup-repos.ts";
import { createWorkspace } from "./operations/create-workspace.ts";
import { analyze } from "./operations/analyze.ts";
import { plan } from "./operations/plan.ts";
import { implement } from "./operations/implement.ts";

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

  constructor(config: OpenCodeProviderConfig) {
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
  async commitPushRepos(opts: CommitPushReposOptions): Promise<CommitPushReposResult> {
    return commitPushRepos(await this.client(), this.#config, opts);
  }
  async cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult> {
    return cleanupRepos(opts);
  }
  async createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> {
    return createWorkspace(opts);
  }
  async analyze(opts: AnalyzeOptions): Promise<AnalyzeResult> {
    return analyze(await this.client(), this.#config, opts);
  }
  async plan(opts: PlanOptions): Promise<PlanResult> {
    return plan(await this.client(), this.#config, opts);
  }
  async implement(opts: ImplementOptions): Promise<ImplementResult> {
    return implement(await this.client(), this.#config, opts);
  }
}
