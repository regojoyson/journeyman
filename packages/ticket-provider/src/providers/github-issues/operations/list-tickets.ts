import type { ListTicketsOptions, ListTicketsResult } from "@journeyman/core";
import { formatGitHubError, type GitHubClient } from "@journeyman/github-api";
import { parseOwnerRepo } from "../utils/parse-ids.ts";
import { toTicket, type GitHubIssue } from "./create-ticket.ts";

export async function listTickets(
  client: GitHubClient,
  opts: ListTicketsOptions,
): Promise<ListTicketsResult> {
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
    const tickets = (data as unknown as GitHubIssue[])
      .filter((i) => i.pull_request == null)
      .filter((i) => !opts.assignee || (i.assignees ?? []).some((a) => a.login === opts.assignee))
      .map((i) => toTicket(owner, repo, i));
    return { tickets };
  } catch (err) {
    return { tickets: [], error: formatGitHubError("issues.listForRepo", err) };
  }
}
