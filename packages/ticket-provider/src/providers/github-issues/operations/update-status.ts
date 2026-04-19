import type { UpdateStatusOptions, UpdateStatusResult } from "@journeyman/core";
import { formatGitHubError, type GitHubClient } from "@journeyman/github-api";
import { parseIssueId } from "../utils/parse-ids.ts";
import { toTicket, type GitHubIssue } from "./create-ticket.ts";

const STATUS_LABEL_PREFIX = "status:";

export async function updateStatus(
  client: GitHubClient,
  opts: UpdateStatusOptions,
): Promise<UpdateStatusResult> {
  const { owner, repo, number } = parseIssueId(opts.id);
  try {
    const { data: current } = await client.rest.issues.get({
      owner,
      repo,
      issue_number: number,
    });
    const keepLabels = (current.labels ?? [])
      .map((l) => (typeof l === "string" ? l : l.name ?? ""))
      .filter((n) => n !== "" && !n.startsWith(STATUS_LABEL_PREFIX));

    const newLabel = `${STATUS_LABEL_PREFIX}${opts.status}`;
    const nextLabels = [...keepLabels, newLabel];

    const terminalStatuses = new Set(["done", "closed", "Done", "Closed"]);
    const state: "open" | "closed" = terminalStatuses.has(opts.status) ? "closed" : "open";

    const { data } = await client.rest.issues.update({
      owner,
      repo,
      issue_number: number,
      labels: nextLabels,
      state,
    });
    return { ticket: toTicket(owner, repo, data as unknown as GitHubIssue) };
  } catch (err) {
    return { error: formatGitHubError("issues.update (status)", err) };
  }
}
