import type { IGitProvider, IProviderMeta } from "@journeyman/core";
import type {
  GetRepoOptions, GetRepoResult,
  CreatePROptions, CreatePRResult,
  ListPROptions, ListPRResult,
  CloneReposOptions, CloneReposResult,
  ListPRCommentsOptions, ListPRCommentsResult,
  ListReposOptions, ListReposResult, RepoSummary,
} from "@journeyman/core";
import { cloneRepos as gitlabCloneRepos } from "./operations/clone-repos.ts";
import { createPR as gitlabCreatePR } from "./operations/create-pr.ts";

export type GitLabProviderOptions = {
  /** Personal access token (PRIVATE-TOKEN). */
  token?: string;
  /** Instance base URL; defaults to https://gitlab.com. Self-hosted: https://gitlab.acme.com */
  baseUrl?: string;
};

/**
 * GitLab REST API provider. Base-URL aware (covers gitlab.com + self-hosted).
 * Phase 2 implements `listRepos`; clone/MR operations remain unimplemented.
 */
export class GitLabProvider implements IGitProvider {
  static meta: IProviderMeta = {
    id: "gitlab",
    name: "GitLab REST",
    description: "GitLab REST API provider for projects and MRs",
    category: "git",
  };

  private readonly token: string | undefined;
  private readonly baseUrl: string;

  constructor(opts: GitLabProviderOptions = {}) {
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? "https://gitlab.com").replace(/\/+$/, "");
  }

  getRepo(_opts: GetRepoOptions): Promise<GetRepoResult> { throw new Error("GitLabProvider.getRepo not implemented"); }

  async createPR(opts: CreatePROptions): Promise<CreatePRResult> {
    if (!this.token) throw new Error("GitLabProvider: token is required");
    return gitlabCreatePR(this.token, this.baseUrl, opts);
  }

  async listPRs(_opts: ListPROptions): Promise<ListPRResult> { throw new Error("GitLabProvider.listPRs not implemented"); }

  async cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult> {
    if (!this.token) return { repos: [], error: "GitLabProvider: token is required" };
    return gitlabCloneRepos(this.token, this.baseUrl, opts);
  }

  async listPRComments(_opts: ListPRCommentsOptions): Promise<ListPRCommentsResult> { throw new Error("GitLabProvider.listPRComments not implemented"); }

  async listRepos(opts: ListReposOptions): Promise<ListReposResult> {
    if (!this.token) return { repos: [], error: "GitLabProvider: token is required" };
    const perPage = Math.min(opts.limit ?? 100, 100);
    const params = new URLSearchParams({
      membership: "true",
      simple: "true",
      order_by: "path",
      sort: "asc",
      per_page: String(perPage),
    });
    if (opts.search) params.set("search", opts.search);
    try {
      const res = await fetch(`${this.baseUrl}/api/v4/projects?${params.toString()}`, {
        headers: { "PRIVATE-TOKEN": this.token },
      });
      if (!res.ok) {
        return { repos: [], error: `GitLab projects list failed: ${res.status} ${res.statusText}` };
      }
      const data = (await res.json()) as Array<{
        name: string;
        path_with_namespace: string;
        http_url_to_repo: string;
        web_url: string;
        default_branch?: string;
        visibility?: string;
      }>;
      const repos: RepoSummary[] = data.map((p) => ({
        name: p.name,
        fullName: p.path_with_namespace,
        url: p.http_url_to_repo ?? p.web_url,
        defaultBranch: p.default_branch ?? "main",
        isPrivate: (p.visibility ?? "private") !== "public",
      }));
      return { repos };
    } catch (err: any) {
      return { repos: [], error: `GitLab projects list failed: ${err?.message ?? String(err)}` };
    }
  }
}
