import type {
  CreatePROptions, CreatePRResult,
  GetRepoOptions, GetRepoResult,
  ListPROptions, ListPRResult,
  CloneReposOptions, CloneReposResult,
  ListPRCommentsOptions, ListPRCommentsResult,
  ListReposOptions, ListReposResult,
} from "../types/git.types.ts";

/**
 * Contract for git hosting providers (GitHub, GitLab).
 * Covers platform REST API operations (repos, PRs/MRs) AND deterministic local
 * git operations that need host credentials (cloneRepos).
 */
export interface IGitProvider {
  getRepo(opts: GetRepoOptions): Promise<GetRepoResult>;
  createPR(opts: CreatePROptions): Promise<CreatePRResult>;
  listPRs(opts: ListPROptions): Promise<ListPRResult>;
  cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult>;
  listPRComments(opts: ListPRCommentsOptions): Promise<ListPRCommentsResult>;
  /** Enumerate repositories reachable by the provider's credential (Connections / Phase 2). Optional. */
  listRepos?(opts: ListReposOptions): Promise<ListReposResult>;
}
