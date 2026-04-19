import type { GetTicketOptions, GetTicketResult } from "@journeyman/core";
import { formatGitHubError, type GitHubClient } from "@journeyman/github-api";
import { parseIssueId } from "../utils/parse-ids.ts";
import { toTicket, type GitHubIssue } from "./create-ticket.ts";

export async function getTicket(
  client: GitHubClient,
  opts: GetTicketOptions,
): Promise<GetTicketResult> {
  const { owner, repo, number } = parseIssueId(opts.id);
  try {
    const { data } = await client.rest.issues.get({
      owner,
      repo,
      issue_number: number,
    });
    return { ticket: toTicket(owner, repo, data as unknown as GitHubIssue) };
  } catch (err) {
    return { error: `not found: ${opts.id} (${formatGitHubError("issues.get", err)})` };
  }
}
