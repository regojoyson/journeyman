export function parseOwnerRepo(projectId: string | undefined): { owner: string; repo: string } {
  if (!projectId || !projectId.includes("/")) {
    throw new Error(
      `GitHubIssuesProvider: projectId must be "owner/repo", got ${JSON.stringify(projectId)}`,
    );
  }
  const [owner, repo] = projectId.split("/");
  if (!owner || !repo) {
    throw new Error(
      `GitHubIssuesProvider: projectId must be "owner/repo", got ${JSON.stringify(projectId)}`,
    );
  }
  return { owner, repo };
}

export function parseIssueId(id: string): { owner: string; repo: string; number: number } {
  const normalized = id.replace(/^github:/, "");
  const match = /^([^/]+)\/([^#]+)#(\d+)$/.exec(normalized);
  if (!match) {
    throw new Error(
      `GitHubIssuesProvider: id must be "owner/repo#<number>", got ${JSON.stringify(id)}`,
    );
  }
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}
