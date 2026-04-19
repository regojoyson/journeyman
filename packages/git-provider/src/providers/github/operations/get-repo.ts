import type { GetRepoOptions, GetRepoResult } from "@journeyman/core";
import { formatGitHubError, type GitHubClient } from "@journeyman/github-api";

export async function getRepo(
  client: GitHubClient,
  opts: GetRepoOptions,
): Promise<GetRepoResult> {
  try {
    const { data } = await client.rest.repos.get({
      owner: opts.owner,
      repo: opts.repo,
    });
    return {
      name: data.name,
      fullName: data.full_name,
      url: data.html_url,
      defaultBranch: data.default_branch,
      sessionId: opts.sessionId,
    };
  } catch (e) {
    return {
      name: "",
      fullName: "",
      url: "",
      defaultBranch: "",
      error: formatGitHubError("repos.get", e),
      sessionId: opts.sessionId,
    };
  }
}
