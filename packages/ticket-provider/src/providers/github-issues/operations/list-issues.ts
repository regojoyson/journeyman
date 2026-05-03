import type { ListIssuesOptions, ListIssuesResult } from "@journeyman/core";
import { formatGitHubError, type GitHubClient } from "@journeyman/github-api";
import { parseOwnerRepo } from "../utils/parse-ids.ts";
import { toIssue, type GitHubIssue } from "./create-issue.ts";

export async function listIssues(
  client: GitHubClient,
  opts: ListIssuesOptions,
): Promise<ListIssuesResult> {
  const { owner, repo } = parseOwnerRepo(opts.projectId);
  const stateInput = opts.status?.toLowerCase();
  const state: "open" | "closed" | "all" =
    stateInput === "open" || stateInput === "closed" ? stateInput : "all";

  try {
    const { data } = await client.rest.issues.listForRepo({
      owner,
      repo,
      state,
      per_page: 100,
    });
    const issues = (data as unknown as GitHubIssue[])
      .filter((i) => i.pull_request == null)
      .filter((i) => !opts.assignee || (i.assignees ?? []).some((a) => a.login === opts.assignee))
      .map((i) => toIssue(owner, repo, i));
    return { issues };
  } catch (err) {
    return { issues: [], error: formatGitHubError("issues.listForRepo", err) };
  }
}
