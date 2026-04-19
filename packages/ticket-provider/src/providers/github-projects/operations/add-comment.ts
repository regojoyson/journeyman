import type { AddCommentOptions, AddCommentResult } from "@journeyman/core";
import type { GitHubClient } from "@journeyman/github-api";

export async function addComment(
  _client: GitHubClient,
  _opts: AddCommentOptions,
): Promise<AddCommentResult> {
  return {
    error:
      "GitHubProjectsProvider: comments are not supported on Projects V2 draft items. Comment on the underlying issue via GitHubIssuesProvider instead.",
  };
}
