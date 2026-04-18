import type { UpdateStatusOptions, UpdateStatusResult } from "@journeyman/core";
import { callTool, type Client } from "@journeyman/github-mcp";
import { parseIssueId } from "../utils/parse-ids.ts";
import { toTicket } from "./create-ticket.ts";

type GitHubIssue = Parameters<typeof toTicket>[2];
const STATUS_LABEL_PREFIX = "status:";

export async function updateStatus(
  client: Client,
  opts: UpdateStatusOptions,
): Promise<UpdateStatusResult> {
  const { owner, repo, number } = parseIssueId(opts.id);
  try {
    // Read current labels
    const current = await callTool<GitHubIssue>(client, "issue_read", {
      method: "get", owner, repo, issue_number: number,
    });
    const keepLabels = (current.labels ?? [])
      .map((l: any) => typeof l === "string" ? l : l.name)
      .filter((n: string) => !n.startsWith(STATUS_LABEL_PREFIX));

    const newLabel = `${STATUS_LABEL_PREFIX}${opts.status}`;
    const nextLabels = [...keepLabels, newLabel];

    // Only close when status is terminal
    const terminalStatuses = new Set(["done", "closed", "Done", "Closed"]);
    const state = terminalStatuses.has(opts.status) ? "closed" : "open";

    const issue = await callTool<GitHubIssue>(client, "issue_write", {
      method: "update",
      owner, repo, issue_number: number,
      labels: nextLabels,
      state,
    });
    return { ticket: toTicket(owner, repo, issue) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
