import type {
  CreateIssueOptions,
  CreateIssueResult,
  Issue,
} from "@journeyman/core";
import { formatGitHubError, type GitHubClient } from "@journeyman/github-api";
import { parseOwnerRepo } from "../utils/parse-ids.ts";

export type GitHubIssue = {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  state: string;
  html_url: string;
  assignees?: { login: string }[] | null;
  labels: ({ name?: string } | string)[];
  created_at: string;
  updated_at: string;
  user?: { login: string } | null;
  pull_request?: unknown;
};

function mapLabel(l: { name?: string } | string): string {
  return typeof l === "string" ? l : (l.name ?? "");
}

export function toIssue(owner: string, repo: string, issue: GitHubIssue): Issue {
  return {
    id: `${owner}/${repo}#${issue.number}`,
    title: issue.title,
    description: issue.body ?? undefined,
    status: issue.state,
    assignee: issue.assignees?.[0]?.login,
    labels: (issue.labels ?? []).map(mapLabel).filter((n) => n !== ""),
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

export async function createIssue(
  client: GitHubClient,
  opts: CreateIssueOptions,
): Promise<CreateIssueResult> {
  const { owner, repo } = parseOwnerRepo(opts.projectId);
  try {
    const { data } = await client.rest.issues.create({
      owner,
      repo,
      title: opts.title,
      body: opts.description,
      assignees: opts.assignee ? [opts.assignee] : undefined,
      labels: opts.labels,
    });
    let issue = toIssue(owner, repo, data as unknown as GitHubIssue);

    const targetState = mapStateFromStatus(opts.status);
    if (targetState && targetState !== data.state) {
      const { data: updated } = await client.rest.issues.update({
        owner,
        repo,
        issue_number: data.number,
        state: targetState,
      });
      issue = toIssue(owner, repo, updated as unknown as GitHubIssue);
    }

    return { issue };
  } catch (err) {
    return { error: formatGitHubError("issues.create", err) };
  }
}
