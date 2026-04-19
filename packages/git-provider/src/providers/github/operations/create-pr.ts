import type { CreatePROptions, CreatePRResult } from "@journeyman/core";
import { formatGitHubError, type GitHubClient } from "@journeyman/github-api";

export async function createPR(
  client: GitHubClient,
  opts: CreatePROptions,
): Promise<CreatePRResult> {
  try {
    const { data } = await client.rest.pulls.create({
      owner: opts.owner,
      repo: opts.repo,
      title: opts.title,
      body: opts.body,
      head: opts.sourceBranch,
      base: opts.targetBranch,
    });
    return {
      id: String(data.id),
      url: data.html_url,
      number: data.number,
      sessionId: opts.sessionId,
    };
  } catch (e) {
    return {
      id: "",
      url: "",
      number: 0,
      error: formatGitHubError("pulls.create", e),
      sessionId: opts.sessionId,
    };
  }
}
