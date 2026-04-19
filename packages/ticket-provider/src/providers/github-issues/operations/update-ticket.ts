import type { UpdateTicketOptions, UpdateTicketResult } from "@journeyman/core";
import { formatGitHubError, type GitHubClient } from "@journeyman/github-api";
import { parseIssueId } from "../utils/parse-ids.ts";
import { toTicket, type GitHubIssue } from "./create-ticket.ts";

function mapStateFromStatus(status: string | undefined): "open" | "closed" | undefined {
  if (!status) return undefined;
  const s = status.toLowerCase();
  return s === "closed" || s === "done" ? "closed" : "open";
}

export async function updateTicket(
  client: GitHubClient,
  opts: UpdateTicketOptions,
): Promise<UpdateTicketResult> {
  const { owner, repo, number } = parseIssueId(opts.id);
  const args: Record<string, unknown> = {
    owner,
    repo,
    issue_number: number,
  };
  if (opts.title !== undefined) args.title = opts.title;
  if (opts.description !== undefined) args.body = opts.description;
  if (opts.assignee !== undefined) args.assignees = [opts.assignee];
  if (opts.labels !== undefined) args.labels = opts.labels;
  const state = mapStateFromStatus(opts.status);
  if (state !== undefined) args.state = state;

  const updateFieldKeys = ["title", "body", "assignees", "labels", "state"];
  if (!updateFieldKeys.some((k) => k in args)) {
    return { error: "updateTicket: no fields to update" };
  }

  try {
    const { data } = await client.rest.issues.update(
      args as Parameters<typeof client.rest.issues.update>[0],
    );
    return { ticket: toTicket(owner, repo, data as unknown as GitHubIssue) };
  } catch (err) {
    return { error: formatGitHubError("issues.update", err) };
  }
}
