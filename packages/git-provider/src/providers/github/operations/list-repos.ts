import type { GitHubClient } from "@journeyman/github-api";
import { formatGitHubError } from "@journeyman/github-api";
import type { ListReposOptions, ListReposResult, RepoSummary } from "@journeyman/core";

export async function listRepos(client: GitHubClient, opts: ListReposOptions): Promise<ListReposResult> {
  try {
    const { data } = await client.rest.repos.listForAuthenticatedUser({
      per_page: Math.min(opts.limit ?? 100, 100),
      sort: "full_name",
    });
    let repos: RepoSummary[] = data.map((r) => ({
      name: r.name,
      fullName: r.full_name,
      url: r.clone_url ?? r.html_url,
      defaultBranch: r.default_branch ?? "main",
      isPrivate: r.private ?? false,
    }));
    if (opts.search) {
      const q = opts.search.toLowerCase();
      repos = repos.filter((r) => r.fullName.toLowerCase().includes(q));
    }
    return { repos };
  } catch (err) {
    return { repos: [], error: formatGitHubError("repos.listForAuthenticatedUser", err) };
  }
}
