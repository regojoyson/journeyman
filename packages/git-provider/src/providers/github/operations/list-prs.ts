import type { ListPROptions, ListPRResult, ListPRItem } from "@journeyman/core";
import { callTool, type Client } from "@journeyman/github-mcp";

type GitHubPR = {
  id: number;
  number: number;
  html_url: string;
  state: string;
  head: { label: string };
};

export async function listPRs(client: Client, opts: ListPROptions): Promise<ListPRResult> {
  try {
    const prs = await callTool<GitHubPR[]>(client, "list_pull_requests", {
      owner: opts.owner,
      repo: opts.repo,
      state: opts.state ?? "open",
      head: opts.head,
    });
    return {
      prs: prs.map<ListPRItem>(p => ({
        id: String(p.id),
        url: p.html_url,
        number: p.number,
        head: p.head.label,
        state: p.state,
      })),
    };
  } catch (err) {
    return { prs: [], error: (err as Error).message };
  }
}
