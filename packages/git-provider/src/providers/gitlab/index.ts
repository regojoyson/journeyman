import type { IGitProvider } from "@journeyman/core";
import type { GetRepoOptions, GetRepoResult, CreatePROptions, CreatePRResult } from "@journeyman/core";

/** GitLab REST API provider. Not yet implemented. */
export class GitLabProvider implements IGitProvider {
  getRepo(_opts: GetRepoOptions): Promise<GetRepoResult> { throw new Error("GitLabProvider.getRepo not implemented"); }
  createPR(_opts: CreatePROptions): Promise<CreatePRResult> { throw new Error("GitLabProvider.createPR not implemented"); }
}
