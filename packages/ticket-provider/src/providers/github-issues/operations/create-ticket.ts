
import type {
  CreateTicketOptions,
  CreateTicketResult,
  Ticket,
} from "@journeyman/core";
import { callTool, type Client } from "@journeyman/github-mcp";
import { parseOwnerRepo } from "../utils/parse-ids.ts";

type GitHubIssue = {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  assignees: { login: string }[];
  labels: ({ name: string } | string)[];
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
  pull_request?: unknown;
};

function mapLabel(l: { name: string } | string): string {
  return typeof l === "string" ? l : l.name;
}

export function toTicket(owner: string, repo: string, issue: GitHubIssue): Ticket {
  return {
    id: `${owner}/${repo}#${issue.number}`,
    title: issue.title,
    description: issue.body ?? undefined,
    status: issue.state,
    assignee: issue.assignees[0]?.login,
    labels: issue.labels.map(mapLabel),
    url: issue.html_url,
    reporter: issue.user?.login,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
  };
}

function mapStateFromStatus(status: string | undefined): "open" | "closed" | undefined {
  if (!status) return undefined;
  const s = status.toLowerCase();
  return s === "closed" || s === "done" ? "closed" : "open";
}

export async function createTicket(
  client: Client,
  opts: CreateTicketOptions,
): Promise<CreateTicketResult> {
  const { owner, repo } = parseOwnerRepo(opts.projectId);
  const args: Record<string, unknown> = {
    method: "create",
    owner,
    repo,
    title: opts.title,
  };
  if (opts.description) args.body = opts.description;
  if (opts.assignee) args.assignees = [opts.assignee];
  if (opts.labels?.length) args.labels = opts.labels;

  try {
    const issue = await callTool<GitHubIssue>(client, "issue_write", args);
    let ticket = toTicket(owner, repo, issue);

    // status is lossy (open/closed only) — apply via a follow-up update if requested
    const targetState = mapStateFromStatus(opts.status);
    if (targetState && targetState !== issue.state) {
      const updated = await callTool<GitHubIssue>(client, "issue_write", {
        method: "update",
        owner,
        repo,
        issue_number: issue.number,
        state: targetState,
      });
      ticket = toTicket(owner, repo, updated);
    }

    return { ticket };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
