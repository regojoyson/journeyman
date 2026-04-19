import type {
  AddCommentOptions,
  AddCommentResult,
  TicketComment,
} from "@journeyman/core";
import { formatGitHubError, type GitHubClient } from "@journeyman/github-api";
import { parseIssueId } from "../utils/parse-ids.ts";

export async function addComment(
  client: GitHubClient,
  opts: AddCommentOptions,
): Promise<AddCommentResult> {
  const { owner, repo, number } = parseIssueId(opts.id);
  try {
    const { data } = await client.rest.issues.createComment({
      owner,
      repo,
      issue_number: number,
      body: opts.body,
    });
    const mapped: TicketComment = {
      id: String(data.id),
      author: data.user?.login,
      body: data.body ?? "",
      createdAt: data.created_at,
    };
    return { comment: mapped };
  } catch (err) {
    return { error: formatGitHubError("issues.createComment", err) };
  }
}
