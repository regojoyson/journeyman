import type {
  IGitProvider,
  GetRepoOptions,
  GetRepoResult,
  CreatePROptions,
  CreatePRResult,
} from "@journeyman/core";
import { connectGitHubMcp, type Client } from "@journeyman/github-mcp";
import { getRepo } from "./operations/get-repo.ts";
import { createPR } from "./operations/create-pr.ts";

export type GitHubProviderOptions = {
  /** Personal Access Token. Falls back to GITHUB_ACCESS_TOKEN env var. */
  token?: string;
};

export class GitHubProvider implements IGitProvider {
  private readonly token: string;
  private client?: Client;

  constructor(opts: GitHubProviderOptions = {}) {
    const token = opts.token ?? process.env.GITHUB_ACCESS_TOKEN;
    if (!token) {
      throw new Error(
        "GitHubProvider: PAT required. Pass opts.token or set GITHUB_ACCESS_TOKEN.",
      );
    }
    this.token = token;
  }

  async getRepo(opts: GetRepoOptions): Promise<GetRepoResult> {
    return getRepo(await this.getClient(), opts);
  }

  async createPR(opts: CreatePROptions): Promise<CreatePRResult> {
    return createPR(await this.getClient(), opts);
  }

  private async getClient(): Promise<Client> {
    if (!this.client)
      this.client = await connectGitHubMcp({
        token: this.token,
        clientName: "journeyman-git-provider",
        clientVersion: "0.0.1",
      });
    return this.client;
  }
}
