import type { IGitProvider } from "@journeyman/core";
import type { GetRepoOptions, GetRepoResult, CreatePROptions, CreatePRResult } from "@journeyman/core";

/** GitHub REST API provider. Not yet implemented. */
export class GitHubProvider implements IGitProvider {
  getRepo(_opts: GetRepoOptions): Promise<GetRepoResult> { throw new Error("GitHubProvider.getRepo not implemented"); }
  createPR(_opts: CreatePROptions): Promise<CreatePRResult> { throw new Error("GitHubProvider.createPR not implemented"); }
}
