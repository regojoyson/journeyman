import type { GetIssueOptions, GetIssueResult } from "@journeyman/core";
import { formatGitHubError, type GitHubClient } from "@journeyman/github-api";
import { parseIssueId } from "../utils/parse-ids.ts";
import { toIssue, type GitHubIssue } from "./create-issue.ts";

export async function getIssue(
  client: GitHubClient,
  opts: GetIssueOptions,
): Promise<GetIssueResult> {
  const { owner, repo, number } = parseIssueId(opts.id);
  try {
    const { data } = await client.rest.issues.get({
      owner,
      repo,
      issue_number: number,
    });
    return { issue: toIssue(owner, repo, data as unknown as GitHubIssue) };
  } catch (err) {
    return { error: `not found: ${opts.id} (${formatGitHubError("issues.get", err)})` };
  }
}
