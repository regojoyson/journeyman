import type { AddCommentOptions, AddCommentResult } from "@journeyman/core";
import type { Client } from "@journeyman/github-mcp";

export async function addComment(
  _client: Client,
  _opts: AddCommentOptions,
): Promise<AddCommentResult> {
  return {
    error:
      "GitHubProjectsProvider: comments are not supported on Projects V2 draft items. Comment on the underlying issue via GitHubIssuesProvider instead.",
  };
}
