import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { UpdateTicketOptions, UpdateTicketResult } from "@journeyman/core";
import { callTool } from "../../_shared/github-mcp-client.ts";
import { parseIssueId } from "../utils/parse-ids.ts";
import { toTicket } from "./create-ticket.ts";

type GitHubIssue = Parameters<typeof toTicket>[2];

function mapStateFromStatus(status: string | undefined): "open" | "closed" | undefined {
  if (!status) return undefined;
  const s = status.toLowerCase();
  return s === "closed" || s === "done" ? "closed" : "open";
}

export async function updateTicket(
  client: Client,
  opts: UpdateTicketOptions,
): Promise<UpdateTicketResult> {
  const { owner, repo, number } = parseIssueId(opts.id);
  const args: Record<string, unknown> = {
    method: "update",
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

  // only title/issue_number are guaranteed; check that at least one update field is present
  const updateFieldKeys = ["title", "body", "assignees", "labels", "state"];
  if (!updateFieldKeys.some((k) => k in args)) {
    return { error: "updateTicket: no fields to update" };
  }

  try {
    const issue = await callTool<GitHubIssue>(client, "issue_write", args);
    return { ticket: toTicket(owner, repo, issue) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
