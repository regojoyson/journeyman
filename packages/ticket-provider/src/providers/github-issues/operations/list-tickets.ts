
import type { ListTicketsOptions, ListTicketsResult } from "@journeyman/core";
import { callTool, type Client } from "@journeyman/github-mcp";
import { parseOwnerRepo } from "../utils/parse-ids.ts";
import { toTicket } from "./create-ticket.ts";

type GitHubIssue = Parameters<typeof toTicket>[2];

export async function listTickets(
  client: Client,
  opts: ListTicketsOptions,
): Promise<ListTicketsResult> {
  const { owner, repo } = parseOwnerRepo(opts.projectId);
  const args: Record<string, unknown> = { owner, repo, perPage: 100 };
  const state = opts.status?.toLowerCase();
  if (state === "open" || state === "closed") args.state = state;

  try {
    const issues = await callTool<GitHubIssue[]>(client, "list_issues", args);
    const tickets = issues
      .filter((i) => (i as { pull_request?: unknown }).pull_request == null)
      .filter((i) => !opts.assignee || i.assignees.some((a) => a.login === opts.assignee))
      .map((i) => toTicket(owner, repo, i));
    return { tickets };
  } catch (err) {
    return { tickets: [], error: (err as Error).message };
  }
}
