import type { IGitProvider } from "@journeyman/core";
import type { GetRepoOptions, GetRepoResult, CreatePROptions, CreatePRResult, ListPROptions, ListPRResult } from "@journeyman/core";

/** GitLab REST API provider. Not yet implemented. */
export class GitLabProvider implements IGitProvider {
  getRepo(_opts: GetRepoOptions): Promise<GetRepoResult> { throw new Error("GitLabProvider.getRepo not implemented"); }
  createPR(_opts: CreatePROptions): Promise<CreatePRResult> { throw new Error("GitLabProvider.createPR not implemented"); }
  async listPRs(_opts: ListPROptions): Promise<ListPRResult> { throw new Error("GitLabProvider.listPRs not implemented"); }
}
