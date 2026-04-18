import type {
  CreatePROptions, CreatePRResult,
  GetRepoOptions, GetRepoResult,
  ListPROptions, ListPRResult,
} from "../types/git.types.ts";

/**
 * Contract for git hosting providers (GitHub, GitLab).
 * Covers platform API operations: repos, PRs/MRs, webhooks.
 */
export interface IGitProvider {
  getRepo(opts: GetRepoOptions): Promise<GetRepoResult>;
  createPR(opts: CreatePROptions): Promise<CreatePRResult>;
  listPRs(opts: ListPROptions): Promise<ListPRResult>;
}
