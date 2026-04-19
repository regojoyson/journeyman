import type { ListPROptions, ListPRResult, ListPRItem } from "@journeyman/core";
import { formatGitHubError, type GitHubClient } from "@journeyman/github-api";

export async function listPRs(
  client: GitHubClient,
  opts: ListPROptions,
): Promise<ListPRResult> {
  try {
    const { data } = await client.rest.pulls.list({
      owner: opts.owner,
      repo: opts.repo,
      state: (opts.state ?? "open") as "open" | "closed" | "all",
      head: opts.head,
      per_page: 100,
    });
    return {
      prs: data.map<ListPRItem>((p) => ({
        id: String(p.id),
        url: p.html_url,
        number: p.number,
        head: p.head.label,
        state: p.state,
      })),
    };
  } catch (err) {
    return { prs: [], error: formatGitHubError("pulls.list", err) };
  }
}
