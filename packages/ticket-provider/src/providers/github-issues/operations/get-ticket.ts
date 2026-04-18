import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { GetTicketOptions, GetTicketResult } from "@journeyman/core";
import { callTool } from "../../_shared/github-mcp-client.ts";
import { parseIssueId } from "../utils/parse-ids.ts";
import { toTicket } from "./create-ticket.ts";

type GitHubIssue = Parameters<typeof toTicket>[2];

export async function getTicket(
  client: Client,
  opts: GetTicketOptions,
): Promise<GetTicketResult> {
  const { owner, repo, number } = parseIssueId(opts.id);
  try {
    const issue = await callTool<GitHubIssue>(client, "issue_read", {
      method: "get",
      owner,
      repo,
      issue_number: number,
    });
    return { ticket: toTicket(owner, repo, issue) };
  } catch (err) {
    return { error: `not found: ${opts.id} (${(err as Error).message})` };
  }
}
