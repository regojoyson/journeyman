import type {
  AddCommentOptions,
  AddCommentResult,
  TicketComment,
} from "@journeyman/core";
import { callTool, type Client } from "@journeyman/github-mcp";
import { parseIssueId } from "../utils/parse-ids.ts";

type GitHubComment = {
  id: number;
  body: string;
  user: { login: string } | null;
  created_at: string;
};

export async function addComment(
  client: Client,
  opts: AddCommentOptions,
): Promise<AddCommentResult> {
  const { owner, repo, number } = parseIssueId(opts.id);
  try {
    const comment = await callTool<GitHubComment>(client, "issue_write", {
      method: "add_comment",
      owner,
      repo,
      issue_number: number,
      body: opts.body,
    });
    const mapped: TicketComment = {
      id: String(comment.id),
      author: comment.user?.login,
      body: comment.body,
      createdAt: comment.created_at,
    };
    return { comment: mapped };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
