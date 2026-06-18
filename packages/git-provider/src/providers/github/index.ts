import type {
  IGitProvider,
  GetRepoOptions, GetRepoResult,
  CreatePROptions, CreatePRResult,
  ListPROptions, ListPRResult,
  CloneReposOptions, CloneReposResult,
  ListPRCommentsOptions, ListPRCommentsResult,
  ListReposOptions, ListReposResult,
  IProviderMeta,
} from "@journeyman/core";
import { createGitHubClient, type GitHubClient } from "@journeyman/github-api";
import { getRepo } from "./operations/get-repo.ts";
import { createPR } from "./operations/create-pr.ts";
import { listPRs } from "./operations/list-prs.ts";
import { cloneRepos } from "./operations/clone-repos.ts";
import { listPRComments } from "./operations/list-pr-comments.ts";
import { listRepos } from "./operations/list-repos.ts";

export type GitHubProviderOptions = {
  /** Personal Access Token (explicit). Takes precedence over `tokenEnv`. */
  token?: string;
  /** Name of an env var to read the token from (e.g. "SAM_PORTFOLIO_GITHUB_ACCESS_TOKEN"). */
  tokenEnv?: string;
};

export class GitHubProvider implements IGitProvider {
  static meta: IProviderMeta = {
    id: "github",
    name: "GitHub REST",
    description: "GitHub REST API provider for repos and PRs",
    category: "git",
  };

  private readonly token: string;
  private client?: GitHubClient;

  constructor(opts: GitHubProviderOptions = {}) {
    if (!opts.token) {
      throw new Error("GitHubProvider: opts.token is required.");
    }
    this.token = opts.token;
  }

  async getRepo(opts: GetRepoOptions): Promise<GetRepoResult> {
    return getRepo(this.getClient(), opts);
  }

  async createPR(opts: CreatePROptions): Promise<CreatePRResult> {
    return createPR(this.getClient(), opts);
  }

  async listPRs(opts: ListPROptions): Promise<ListPRResult> {
    return listPRs(this.getClient(), opts);
  }

  async cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult> {
    return cloneRepos(this.token, opts);
  }

  async listPRComments(opts: ListPRCommentsOptions): Promise<ListPRCommentsResult> {
    return listPRComments(opts, { client: this.getClient() });
  }

  async listRepos(opts: ListReposOptions): Promise<ListReposResult> {
    return listRepos(this.getClient(), opts);
  }

  private getClient(): GitHubClient {
    if (!this.client) {
      this.client = createGitHubClient({
        token: this.token,
        userAgent: "journeyman-git-provider/0.1.0",
      });
    }
    return this.client;
  }
}
