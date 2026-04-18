import type { UpdateStatusOptions, UpdateStatusResult } from "@journeyman/core";
import { callTool, type Client } from "@journeyman/github-mcp";
import { parseIssueId } from "../utils/parse-ids.ts";
import { toTicket } from "./create-ticket.ts";

type GitHubIssue = Parameters<typeof toTicket>[2];

function mapStateFromStatus(status: string): "open" | "closed" {
  const s = status.toLowerCase();
  return s === "closed" || s === "done" ? "closed" : "open";
}

export async function updateStatus(
  client: Client,
  opts: UpdateStatusOptions,
): Promise<UpdateStatusResult> {
  const { owner, repo, number } = parseIssueId(opts.id);
  try {
    const issue = await callTool<GitHubIssue>(client, "issue_write", {
      method: "update",
      owner,
      repo,
      issue_number: number,
      state: mapStateFromStatus(opts.status),
    });
    return { ticket: toTicket(owner, repo, issue) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
